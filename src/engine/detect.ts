import type { ColumnMapping, DetectionResult, PresetId, TagPolicy } from './types.ts';

/**
 * Column auto-detection.
 * Headers are normalized (lowercased, separators removed) and matched against
 * role synonym sets and the policy's mandatory-tag synonyms. Tag columns may
 * carry provider prefixes ("user:team", "resourceTags/user:team", "tag:Team")
 * which are stripped before matching.
 */

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s\-_./:()]+/g, '');
}

/** strip common tag-column prefixes used by AWS/Azure exports:
 * "resourceTags/user:X", "resource_tags_user_x" (Athena), "user:X", "tags/x", "label:x" */
export function stripTagPrefix(header: string): string {
  return header
    .replace(/^resource[\s_]*tags?[\s_]*[/:.]?[\s_]*user[\s_]*[/:._]/i, '')
    .replace(/^resource[\s_]*tags?[\s_]*[/:._]/i, '')
    .replace(/^user[\s_]*[/:.]/i, '')
    .replace(/^tags?[\s_]*[/:.]/i, '')
    .replace(/^labels?[\s_]*[/:.]/i, '')
    .trim();
}

const ROLE_SYNONYMS: Record<string, string[]> = {
  resourceId: [
    'resourceid',
    'resource',
    'id',
    'arn',
    'resourcearn',
    'resourcename',
    'instanceid',
    'lineitemresourceid',
  ],
  service: [
    'service',
    'servicename',
    'metercategory', // Azure: service-level grouping, preferred over meter-level ProductName
    'productservicecode',
    'product',
    'productname',
    'productproductname', // CUR: product/ProductName
    'lineitemproductcode',
    'servicecategory',
  ],
  provider: ['provider', 'providername', 'cloud', 'cloudprovider', 'csp', 'vendor', 'platform'],
  region: ['region', 'regionid', 'regionname', 'productregion', 'location', 'resourcelocation', 'availabilityzone', 'az'],
  cost: [
    'monthlycost',
    'cost',
    'unblendedcost',
    'lineitemunblendedcost',
    'amortizedcost',
    'pretaxcost',
    'costinbillingcurrency',
    'billedcost',
    'effectivecost',
    'amount',
    'spend',
    'totalcost',
  ],
  currency: ['currency', 'currencycode', 'lineitemcurrencycode', 'billingcurrency', 'billingcurrencycode'],
  chargeType: [
    'chargetype',
    'chargecategory',
    'lineitemlineitemtype',
    'lineitemtype',
    'chargeclass',
  ],
};

/**
 * Charge types that cannot carry resource tags — taxes, account-level credits
 * and refunds, RI/SP fees and purchases. Excluded from coverage math per the
 * FinOps Foundation playbook's untaggable-resources caveat.
 * Matched against the normalized charge-type value.
 */
export const UNTAGGABLE_CHARGE_TYPES = new Set([
  'tax',
  'credit',
  'refund',
  'fee',
  'rifee',
  'savingsplanrecurringfee',
  'savingsplanupfrontfee',
  'purchase',
  'adjustment',
  'unusedreservation',
  'unusedsavingsplan',
]);

export function isUntaggableChargeType(raw: string | undefined): boolean {
  if (!raw) return false;
  return UNTAGGABLE_CHARGE_TYPES.has(raw.toLowerCase().replace(/[\s\-_./:()]+/g, ''));
}

export function detectColumns(
  headers: string[],
  policy: TagPolicy,
  /** optional data rows (same column order as headers) used to break ties
   * between multiple matching columns — the one with more real values wins */
  sampleRows: string[][] = [],
): DetectionResult {
  const notes: string[] = [];
  const mapping: ColumnMapping = { tagColumns: {} };
  const used = new Set<string>();
  let jsonKeys: string[] | undefined;

  const normalized = headers.map((h) => ({
    raw: h,
    norm: normalizeHeader(h),
    tagNorm: normalizeHeader(stripTagPrefix(h)),
  }));

  const sample = sampleRows.slice(0, 500);
  const nonEmptyCount = (header: string): number => {
    const idx = headers.indexOf(header);
    if (idx === -1 || sample.length === 0) return 0;
    let n = 0;
    for (const row of sample) if ((row[idx] ?? '').trim() !== '') n++;
    return n;
  };

  // roles: first synonym-order match wins (synonyms listed most-specific-first)
  for (const [role, synonyms] of Object.entries(ROLE_SYNONYMS)) {
    outer: for (const syn of synonyms) {
      for (const h of normalized) {
        if (used.has(h.raw)) continue;
        if (h.norm === syn) {
          (mapping as unknown as Record<string, unknown>)[role] = h.raw;
          used.add(h.raw);
          break outer;
        }
      }
    }
  }

  // mandatory tags: collect ALL matching columns, then pick the one with the
  // most real values (drift scenario: "env" + "Environment" both match —
  // the mostly-empty duplicate must not win the mapping)
  for (const tag of policy.mandatoryTags) {
    const candidates = new Set([normalizeHeader(tag.key), ...tag.synonyms.map(normalizeHeader)]);
    const matches = normalized.filter(
      (h) => !used.has(h.raw) && (candidates.has(h.tagNorm) || candidates.has(h.norm)),
    );
    if (matches.length === 0) continue;
    let chosen = matches[0].raw;
    if (matches.length > 1) {
      chosen = matches.map((m) => m.raw).sort((a, b) => nonEmptyCount(b) - nonEmptyCount(a))[0];
      notes.push(
        `Multiple columns look like "${tag.label}" (${matches
          .map((m) => m.raw)
          .join(', ')}) — mapped the one with the most values: "${chosen}". Check the drift report.`,
      );
    }
    mapping.tagColumns[tag.key] = chosen;
    used.add(chosen);
  }

  // JSON tag column (FOCUS "Tags", CUR 2.0 "resource_tags"): cell values are
  // JSON objects. Detect it, scan sample keys, and map mandatory tags to keys.
  const jsonCandidates = normalized.filter(
    (h) => !used.has(h.raw) && ['tags', 'resourcetags', 'labels'].includes(h.norm),
  );
  for (const cand of jsonCandidates) {
    const idx = headers.indexOf(cand.raw);
    const values = sample.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '' && v.toLowerCase() !== 'null');
    if (values.length === 0) continue;
    // FOCUS/CUR 2.0 use {"k": "v"}; Azure EA exports use brace-less "k": "v","k2": "v2"
    const jsonish = values.filter((v) => v.startsWith('{') || /^"[^"]+"\s*:/.test(v)).length;
    if (jsonish / values.length < 0.5) continue;
    mapping.jsonTagColumn = cand.raw;
    used.add(cand.raw);
    // collect keys present in the JSON objects
    const keys = new Set<string>();
    for (const v of values.slice(0, 100)) {
      const obj = parseTagObject(v);
      if (obj) for (const k of Object.keys(obj)) keys.add(k);
    }
    jsonKeys = [...keys].sort((a, b) => a.localeCompare(b));
    mapping.jsonTagKeys = {};
    for (const tag of policy.mandatoryTags) {
      if (mapping.tagColumns[tag.key]) continue; // explicit column wins
      const cands = new Set([normalizeHeader(tag.key), ...tag.synonyms.map(normalizeHeader)]);
      const match = [...keys].find((k) => cands.has(normalizeHeader(k)));
      if (match) mapping.jsonTagKeys[tag.key] = match;
    }
    const mappedKeys = Object.values(mapping.jsonTagKeys);
    notes.push(
      `Tags found as JSON in "${cand.raw}"` +
        (mappedKeys.length > 0
          ? ` — mapped: ${mappedKeys.join(', ')}. Other keys present: ${[...keys]
              .filter((k) => !mappedKeys.includes(k))
              .join(', ') || 'none'}.`
          : `, but none of its keys (${[...keys].join(', ')}) match your mandatory tags.`),
    );
    break;
  }

  const preset = detectPreset(normalized.map((h) => h.norm));
  if (preset !== 'generic') notes.push(`Recognized a ${presetLabel(preset)} export.`);

  // confidence: resourceId and cost are the core roles; tags add the rest
  let score = 0;
  if (mapping.resourceId) score += 0.3;
  if (mapping.cost) score += 0.3;
  score += 0.4 * (Object.keys(mapping.tagColumns).length / Math.max(1, policy.mandatoryTags.length));

  if (!mapping.cost) notes.push('No cost column found — scoring will be resource-count only.');
  if (!mapping.resourceId) notes.push('No resource id column found — row numbers will be used as ids.');

  return { preset, mapping, confidence: Math.round(score * 100) / 100, notes, jsonKeys };
}

/** Parse a tag cell as a JSON object. Accepts proper JSON ({"k":"v"}) and
 * Azure's brace-less pair list ("k": "v","k2": "v2"). Returns null if neither. */
export function parseTagObject(raw: string): Record<string, unknown> | null {
  const v = raw.trim();
  if (v === '' || v.toLowerCase() === 'null') return null;
  const candidates = v.startsWith('{') ? [v] : [`{${v}}`];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return null;
}

function detectPreset(normHeaders: string[]): PresetId {
  const has = (s: string) => normHeaders.includes(s);
  if (has('billedcost') && (has('chargecategory') || has('providername'))) return 'focus';
  if (normHeaders.some((h) => h.startsWith('lineitem'))) return 'aws-cur';
  if (has('metercategory') || has('pretaxcost') || has('costinbillingcurrency') || has('resourcelocation'))
    return 'azure-cost-mgmt';
  if (has('unblendedcost') || has('amortizedcost')) return 'aws-cost-explorer';
  return 'generic';
}

export function presetLabel(p: PresetId): string {
  switch (p) {
    case 'aws-cur':
      return 'AWS CUR';
    case 'aws-cost-explorer':
      return 'AWS Cost Explorer';
    case 'azure-cost-mgmt':
      return 'Azure Cost Management';
    case 'focus':
      return 'FOCUS (FinOps Open Cost & Usage Specification)';
    case 'generic':
      return 'generic CSV';
  }
}
