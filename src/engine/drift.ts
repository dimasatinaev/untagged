import type { DriftFinding, Resource, TagPolicy } from './types.ts';
import { normalizeHeader, stripTagPrefix } from './detect.ts';
import { isNullToken, normalizeValue } from './policy.ts';

/**
 * Drift detection.
 *
 * Key drift: multiple CSV columns that normalize to the same thing, or that
 * match the same mandatory tag's synonym set ("env" + "Environment").
 *
 * Value drift (within one mapped tag column): case variants, token-order
 * variants ("payments-team" vs "team-payments"), known environment aliases
 * (prod/production), prefix pairs (prod ⊂ production), and 1-edit typos.
 *
 * Deliberately conservative: findings are suggestions, never auto-applied.
 */

export function detectKeyDrift(headers: string[], policy: TagPolicy): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // group headers by normalized (prefix-stripped) form
  const byNorm = new Map<string, string[]>();
  for (const h of headers) {
    const n = normalizeHeader(stripTagPrefix(h));
    if (!n) continue;
    const list = byNorm.get(n) ?? [];
    list.push(h);
    byNorm.set(n, list);
  }
  for (const [, members] of byNorm) {
    if (new Set(members).size > 1) {
      findings.push({
        type: 'key',
        members: [...new Set(members)],
        suggestion: `These columns normalize to the same key — likely duplicates: ${members.join(', ')}`,
      });
    }
  }

  // headers matching the same mandatory tag via synonyms
  for (const tag of policy.mandatoryTags) {
    const cands = new Set([normalizeHeader(tag.key), ...tag.synonyms.map(normalizeHeader)]);
    const matched = headers.filter((h) => cands.has(normalizeHeader(stripTagPrefix(h))));
    const distinct = [...new Set(matched)];
    if (distinct.length > 1) {
      findings.push({
        type: 'key',
        members: distinct,
        tagKey: tag.key,
        suggestion: `Multiple columns look like "${tag.label}": ${distinct.join(
          ', ',
        )}. Reports grouping by one of them will miss the others.`,
      });
    }
  }

  return dedupeFindings(findings);
}

/** well-known environment value aliases */
const ENV_ALIASES: string[][] = [
  ['prod', 'production', 'prd', 'live'],
  ['dev', 'development'],
  ['stage', 'staging', 'stg'],
  ['test', 'testing', 'qa'],
  ['uat', 'acceptance'],
];

export function detectValueDrift(
  resources: Resource[],
  tagKey: string,
  policy: TagPolicy,
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // collect distinct raw values (excluding null tokens), keyed by normalized form
  const rawByNorm = new Map<string, Set<string>>();
  for (const r of resources) {
    const raw = r.tags[tagKey];
    if (raw === undefined || isNullToken(raw, policy)) continue;
    const norm = normalizeValue(raw);
    const set = rawByNorm.get(norm) ?? new Set<string>();
    set.add(raw.trim());
    rawByNorm.set(norm, set);
  }

  // 1. case/whitespace variants of the same normalized value
  for (const [norm, raws] of rawByNorm) {
    if (raws.size > 1) {
      findings.push({
        type: 'value',
        tagKey,
        members: [...raws],
        suggestion: `Case/format variants of "${norm}" — group-by will split them: ${[...raws].join(', ')}`,
      });
    }
  }

  const norms = [...rawByNorm.keys()];

  // 2. known env aliases
  if (tagKey === 'environment') {
    for (const aliasGroup of ENV_ALIASES) {
      const present = norms.filter((n) => aliasGroup.includes(n));
      if (present.length > 1) {
        findings.push({
          type: 'value',
          tagKey,
          members: present.map((n) => [...(rawByNorm.get(n) ?? [])][0] ?? n),
          suggestion: `"${present.join('" and "')}" usually mean the same environment.`,
        });
      }
    }
  }

  // 3. token-set match (payments-team vs team-payments) and prefix/typo pairs
  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) {
      const a = norms[i];
      const b = norms[j];
      if (inSameAliasGroup(a, b)) continue; // already reported
      const reason = nearMatchReason(a, b);
      if (reason) {
        findings.push({
          type: 'value',
          tagKey,
          members: [displayRaw(rawByNorm, a), displayRaw(rawByNorm, b)],
          suggestion: `"${a}" and "${b}" look like the same value (${reason}).`,
        });
      }
    }
  }

  return dedupeFindings(findings);
}

function displayRaw(rawByNorm: Map<string, Set<string>>, norm: string): string {
  return [...(rawByNorm.get(norm) ?? [])][0] ?? norm;
}

function inSameAliasGroup(a: string, b: string): boolean {
  return ENV_ALIASES.some((g) => g.includes(a) && g.includes(b));
}

function nearMatchReason(a: string, b: string): string | null {
  if (a.length < 3 || b.length < 3) return null;
  // identical non-digit skeletons => sequential codes (CC-1042 vs CC-1043,
  // team-1 vs team-2), which are distinct identifiers, not drift
  if (a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#')) return null;
  // token-set equality
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size > 1 && ta.size === tb.size && [...ta].every((t) => tb.has(t))) {
    return 'same words, different order';
  }
  // prefix pair with meaningful stem (avoid dev/data style false positives)
  if (a.length >= 4 && b.length >= 4) {
    if (b.startsWith(a) && b.length - a.length <= 7 && a.length >= 4) return 'one is a prefix of the other';
    if (a.startsWith(b) && a.length - b.length <= 7 && b.length >= 4) return 'one is a prefix of the other';
  }
  // 1-edit typo for longer values
  if (a.length >= 5 && b.length >= 5 && levenshtein(a, b) === 1) return 'differs by one character';
  return null;
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(/[\s\-_./]+/).filter(Boolean));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function dedupeFindings(findings: DriftFinding[]): DriftFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = f.type + '|' + (f.tagKey ?? '') + '|' + [...f.members].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
