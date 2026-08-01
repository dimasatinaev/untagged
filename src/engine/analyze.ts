import type {
  AnalysisResult,
  ColumnMapping,
  ParseResult,
  Resource,
  ServiceBreakdown,
  TagCoverage,
  TagPolicy,
} from './types.ts';
import { parseCost, streamCsv } from './csv.ts';
import { gradeForScore, isNullToken } from './policy.ts';
import { parseTagObject, isUntaggableChargeType } from './detect.ts';
import { detectKeyDrift, detectValueDrift } from './drift.ts';

export interface AnalyzeOptions {
  /** max offenders returned (default 100) */
  offendersLimit?: number;
  /** max resources returned in the result (default 5000) */
  resourcesLimit?: number;
}

/**
 * Core analysis per PRD §5, aggregation model:
 * - Billing exports contain one line item per resource per day/meter — the
 *   same resource id legitimately appears many times. Costs are SUMMED per
 *   resource; tags fill in from the first line item with a real value.
 * - Cost-weighted coverage (headline): % of positive spend on resources that
 *   have real values for ALL mandatory tags.
 * - Credits (negative line items) are excluded from coverage math, counted
 *   separately. Null tokens ("n/a", "-", "NULL"...) count as missing.
 * - Row access is index-based and streaming-friendly: memory holds only the
 *   aggregated per-resource map, never the row matrix.
 */

interface Aggregator {
  push: (row: string[], rowIndex: number) => void;
  finalize: (totalRows: number) => AnalysisResult;
}

function createAggregator(
  headers: string[],
  mapping: ColumnMapping,
  policy: TagPolicy,
  options: AnalyzeOptions,
): Aggregator {
  const offendersLimit = options.offendersLimit ?? 100;
  const hasCost = Boolean(mapping.cost);

  const col = (name?: string) => (name ? headers.indexOf(name) : -1);
  const iId = col(mapping.resourceId);
  const iSvc = col(mapping.service);
  const iProv = col(mapping.provider);
  const iReg = col(mapping.region);
  const iCost = col(mapping.cost);
  const iCur = col(mapping.currency);
  const iCharge = col(mapping.chargeType);
  const iJson = col(mapping.jsonTagColumn);
  const tagCols: Array<[string, number]> = Object.entries(mapping.tagColumns).map(([k, c]) => [
    k,
    headers.indexOf(c),
  ]);
  const jsonTagEntries = Object.entries(mapping.jsonTagKeys ?? {});

  let costMissingCount = 0;
  let creditCount = 0;
  let creditTotal = 0;
  let nettedCreditCount = 0;
  let untaggableCount = 0;
  let untaggableCost = 0;
  let mergedLineItems = 0;
  // currencies observed across the ENTIRE pass (not just the detection sample)
  // — mixed currencies must stop the report rather than be silently summed
  const currencies = new Set<string>();
  const byId = new Map<string, Resource>();
  // per-resource service -> summed cost; a resource's line items span multiple
  // meter categories (VM hours + bandwidth + disks) — the resource is labeled
  // by its dominant-cost category, not whichever line item came first
  const svcCosts = new Map<string, Map<string, number>>();

  const push = (row: string[], rowIndex: number): void => {
    if (iCur >= 0) {
      const cur = normalizeCurrency(row[iCur]);
      if (cur) currencies.add(cur);
    }
    let cost: number | undefined;
    if (hasCost) {
      cost = parseCost(row[iCost]);
      if (cost === undefined) costMissingCount++;
    }
    // untaggable charge types (tax, credits, fees, RI/SP purchases) are their
    // own bucket — they can't carry tags, so they must not lower the score or
    // appear as "fixable"
    if (iCharge >= 0 && isUntaggableChargeType(row[iCharge])) {
      untaggableCount++;
      untaggableCost += cost ?? 0;
      return;
    }
    const rawId = iId >= 0 ? row[iId] : undefined;
    const hasRealId = rawId !== undefined && !isNullToken(rawId, policy);
    // negative line items: attached to a resource -> netted into its cost
    // (a discount belongs to its resource); unattached -> account-level credit
    if ((cost ?? 0) < 0) {
      if (!hasRealId) {
        creditCount++;
        creditTotal += cost!;
        return;
      }
      nettedCreditCount++;
    }
    const id = hasRealId ? rawId : `row-${rowIndex}`;
    // Azure resource ids vary in casing between line items of the same
    // resource — aggregate case-insensitively, display the first-seen form
    const idKey = id.toLowerCase();

    let res = byId.get(idKey);
    if (res === undefined) {
      res = {
        id,
        service: iSvc >= 0 ? row[iSvc] || undefined : undefined,
        provider: iProv >= 0 ? row[iProv] || undefined : undefined,
        region: iReg >= 0 ? row[iReg] || undefined : undefined,
        cost: hasCost ? 0 : undefined,
        tags: {},
        lineItems: 0,
      };
      byId.set(idKey, res);
    } else {
      mergedLineItems++;
      if (res.service === undefined && iSvc >= 0 && row[iSvc]) res.service = row[iSvc];
    }
    res.lineItems = (res.lineItems ?? 0) + 1;
    if (hasCost && cost !== undefined) res.cost = (res.cost ?? 0) + cost;

    if (iSvc >= 0 && row[iSvc]) {
      let m = svcCosts.get(idKey);
      if (!m) {
        m = new Map();
        svcCosts.set(idKey, m);
      }
      // weight by |cost| so zero-cost line items still count a little via ties;
      // add a tiny epsilon per occurrence as tiebreaker
      m.set(row[iSvc], (m.get(row[iSvc]) ?? 0) + Math.abs(cost ?? 0) + 1e-9);
    }

    // tags: JSON column first, explicit columns override; a real value never
    // gets overwritten by a null token from a later line item
    if (iJson >= 0 && jsonTagEntries.length > 0) {
      const obj = parseTagObject(row[iJson] ?? '');
      if (obj) {
        for (const [canonical, jsonKey] of jsonTagEntries) {
          const v = obj[jsonKey];
          if (v !== undefined && v !== null && isNullToken(res.tags[canonical], policy)) {
            res.tags[canonical] = String(v);
          }
        }
      }
    }
    for (const [canonical, ci] of tagCols) {
      const v = row[ci] ?? '';
      if (!isNullToken(v, policy) && isNullToken(res.tags[canonical], policy)) {
        res.tags[canonical] = v;
      }
    }
  };

  const finalize = (totalRows: number): AnalysisResult => {
    const resources = [...byId.values()];
    // resolve dominant-cost service per resource
    for (const [idKey, m] of svcCosts) {
      if (m.size < 2) continue;
      const res = byId.get(idKey);
      if (!res) continue;
      let best = res.service;
      let bestV = -1;
      for (const [svc, v] of m) {
        if (v > bestV) {
          bestV = v;
          best = svc;
        }
      }
      res.service = best;
    }
    // clamp net-negative resources to 0 for scoring (credits exceeded usage)
    let negativeResourceCount = 0;
    for (const r of resources) {
      if (r.cost !== undefined) {
        if (r.cost < 0) {
          negativeResourceCount++;
          r.cost = 0;
        } else {
          r.cost = round2(r.cost);
        }
      }
    }

    const mandatory = policy.mandatoryTags.filter(
      (t) => mapping.tagColumns[t.key] || mapping.jsonTagKeys?.[t.key],
    );
    const isMissing = (r: Resource, key: string) => isNullToken(r.tags[key], policy);
    const isCompliant = (r: Resource) => mandatory.every((t) => !isMissing(r, t.key));

    const totalCost = resources.reduce((s, r) => s + (r.cost ?? 0), 0);
    const compliantCost = resources.reduce((s, r) => s + (isCompliant(r) ? (r.cost ?? 0) : 0), 0);
    const compliantCount = resources.filter(isCompliant).length;

    const resourceCountScore = pct(compliantCount, resources.length);
    const costWeightedScore = hasCost && totalCost > 0 ? pct(compliantCost, totalCost) : null;
    const unallocatedCost = hasCost ? round2(totalCost - compliantCost) : 0;

    // per-resource missing sets, reused for solo-recoverable computation
    const missingByResource = resources.map((r) => mandatory.filter((t) => isMissing(r, t.key)));
    const soloCost = new Map<string, number>();
    resources.forEach((r, i) => {
      if (missingByResource[i].length === 1) {
        const k = missingByResource[i][0].key;
        soloCost.set(k, (soloCost.get(k) ?? 0) + (r.cost ?? 0));
      }
    });

    const perTag: TagCoverage[] = mandatory.map((t) => {
      const withValue = resources.filter((r) => !isMissing(r, t.key));
      const withValueCost = withValue.reduce((s, r) => s + (r.cost ?? 0), 0);
      return {
        key: t.key,
        label: t.label,
        resourcePct: pct(withValue.length, resources.length),
        costPct: hasCost && totalCost > 0 ? pct(withValueCost, totalCost) : null,
        missingCount: resources.length - withValue.length,
        soloRecoverableCost: hasCost ? round2(soloCost.get(t.key) ?? 0) : null,
      };
    });

    const drift = [
      ...detectKeyDrift(headers, policy),
      ...mandatory.flatMap((t) => detectValueDrift(resources, t.key, policy)),
    ];

    const offenders = resources
      .filter((r) => !isCompliant(r))
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      .slice(0, offendersLimit);

    const svcMap = new Map<string, ServiceBreakdown>();
    for (const r of resources) {
      const key = r.service ?? '(no service)';
      const s = svcMap.get(key) ?? {
        service: key,
        totalCost: 0,
        unallocatedCost: 0,
        resourceCount: 0,
        nonCompliantCount: 0,
      };
      s.totalCost += r.cost ?? 0;
      s.resourceCount++;
      if (!isCompliant(r)) {
        s.unallocatedCost += r.cost ?? 0;
        s.nonCompliantCount++;
      }
      svcMap.set(key, s);
    }
    const byService = [...svcMap.values()]
      .map((s) => ({ ...s, totalCost: round2(s.totalCost), unallocatedCost: round2(s.unallocatedCost) }))
      .sort((a, b) => b.unallocatedCost - a.unallocatedCost);

    const headline = costWeightedScore ?? resourceCountScore;

    const resourcesLimit = options.resourcesLimit ?? 5000;
    const sortedResources = [...resources].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

    return {
      totalResources: totalRows,
      analyzedResources: resources.length,
      costWeightedScore,
      resourceCountScore,
      grade: gradeForScore(headline),
      perTag,
      totalCost: round2(totalCost),
      unallocatedCost,
      creditCount,
      creditTotal: round2(creditTotal),
      nettedCreditCount,
      negativeResourceCount,
      untaggableCount,
      untaggableCost: round2(untaggableCost),
      costMissingCount,
      duplicateIdCount: mergedLineItems,
      drift,
      offenders,
      byService,
      resources: sortedResources.slice(0, resourcesLimit),
      resourcesTruncated: resources.length > resourcesLimit,
      currencies: [...currencies].sort(),
    };
  };

  return { push, finalize };
}

/** Analyze a pre-parsed (materialized) file — used for small files and tests. */
export function analyze(
  parsed: ParseResult,
  mapping: ColumnMapping,
  policy: TagPolicy,
  options: AnalyzeOptions = {},
): AnalysisResult {
  const agg = createAggregator(parsed.headers, mapping, policy, options);
  for (let n = 0; n < parsed.rows.length; n++) agg.push(parsed.rows[n], n + 1);
  return agg.finalize(parsed.rows.length);
}

/**
 * Analyze raw CSV text in a single streaming pass — rows are never
 * materialized, so memory stays flat for 100MB+ exports. Returns the result
 * plus parse-level stats.
 */
export function analyzeCsvText(
  text: string,
  mapping: ColumnMapping,
  policy: TagPolicy,
  options: AnalyzeOptions = {},
): { result: AnalysisResult; skippedRows: number; rowCount: number } {
  let agg: Aggregator | null = null;
  const stats = streamCsv(text, {
    onHeaders: (headers) => {
      agg = createAggregator(headers, mapping, policy, options);
    },
    onRow: (row, n) => {
      agg!.push(row, n);
    },
  });
  const result = (agg as Aggregator | null)?.finalize(stats.rowCount) ??
    createAggregator([], mapping, policy, options).finalize(0);
  return { result, skippedRows: stats.skippedCount, rowCount: stats.rowCount };
}

/** normalize a currency cell: trim, uppercase; empty/placeholder -> null */
export function normalizeCurrency(raw: string | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === '' || v === 'N/A' || v === '-' || v === 'NULL' || v === 'NONE') return null;
  return v;
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 100;
  return round2((part / whole) * 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
