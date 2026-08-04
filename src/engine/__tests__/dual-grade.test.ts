import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../csv.ts';
import { detectColumns } from '../detect.ts';
import { analyze } from '../analyze.ts';
import { DEFAULT_POLICY, DIVERGENCE_THRESHOLD_POINTS } from '../policy.ts';

/**
 * Dual-grade model regression tests.
 *
 * Origin: practitioner feedback (r/FinOps, Aug 2026) — the "whale trap".
 * A single expensive compliant resource produced an excellent cost-weighted
 * grade while most of the inventory was non-compliant. Spend allocation and
 * resource compliance are now graded independently: no average, no minimum,
 * no capping, no composite overall grade.
 */

const HEADERS = 'resource_id,service,monthly_cost,owner,team,env,cost_center';

function run(csv: string) {
  const parsed = parseCsv(csv);
  const { mapping } = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  return analyze(parsed, mapping, DEFAULT_POLICY);
}

function diverges(r: { costWeightedScore: number | null; resourceCountScore: number }): boolean {
  return (
    r.costWeightedScore !== null &&
    Math.abs(r.costWeightedScore - r.resourceCountScore) >= DIVERGENCE_THRESHOLD_POINTS
  );
}

test('whale scenario: ~96% spend / 40% resources -> spend A, resources F, divergence', () => {
  const r = run(
    `${HEADERS}\n` +
      `db-whale,RDS,4500,anna,payments,prod,CC-1\n` +
      `bucket-ok,S3,50,eva,search,prod,CC-2\n` +
      `i-bad1,EC2,100,,,,\n` +
      `i-bad2,EC2,50,,,,\n` +
      `i-bad3,EC2,50,,,,`,
  );
  assert.equal(r.compliantResourceCount, 2);
  assert.equal(r.nonCompliantResourceCount, 3);
  assert.equal(r.resourceCountScore, 40);
  assert.ok(r.costWeightedScore! > 95, `spend score ${r.costWeightedScore}`);
  // graded independently — the excellent spend grade does NOT lift resources,
  // and the poor resource grade does NOT cap spend
  assert.equal(r.spendGrade, 'A');
  assert.equal(r.resourceGrade, 'F');
  assert.ok(diverges(r));
  // no composite grade exists on the result at all
  assert.equal((r as unknown as Record<string, unknown>).grade, undefined);
});

test('inverse scenario: high resource compliance, low spend coverage', () => {
  // one expensive non-compliant resource, four cheap compliant ones
  const r = run(
    `${HEADERS}\n` +
      `db-expensive,RDS,4000,,payments,prod,CC-1\n` +
      `i-ok1,EC2,25,anna,payments,prod,CC-1\n` +
      `i-ok2,EC2,25,anna,payments,prod,CC-1\n` +
      `i-ok3,EC2,25,eva,search,dev,CC-2\n` +
      `i-ok4,EC2,25,eva,search,dev,CC-2`,
  );
  assert.equal(r.resourceCountScore, 80);
  assert.equal(r.resourceGrade, 'C');
  assert.ok(r.costWeightedScore! < 5, `spend score ${r.costWeightedScore}`);
  assert.equal(r.spendGrade, 'F');
  assert.ok(diverges(r));
  // direction is the opposite of the whale case
  assert.ok(r.resourceCountScore > r.costWeightedScore!);
});

test('placeholder values: N/A, n/a, unknown stay missing, are summarized, block compliance', () => {
  const r = run(
    `${HEADERS}\n` +
      `i-dummy,EC2,100,N/A,unknown,prod,CC-1\n` +
      `i-dummy2,EC2,100,n/a,payments,prod,CC-1\n` +
      `i-ok,EC2,100,anna,payments,prod,CC-1`,
  );
  // neither placeholder resource is compliant
  assert.equal(r.compliantResourceCount, 1);
  assert.equal(r.nonCompliantResourceCount, 2);
  assert.ok(r.offenders.some((o) => o.id === 'i-dummy'));
  assert.ok(r.offenders.some((o) => o.id === 'i-dummy2'));

  // owner coverage counts them as missing
  const owner = r.perTag.find((t) => t.key === 'owner')!;
  assert.equal(owner.missingCount, 2);
  assert.equal(owner.placeholderCount, 2);

  // placeholder summary: case-normalized, occurrence + resource counts
  const na = r.placeholders.find((p) => p.value === 'n/a')!;
  assert.ok(na, 'n/a summarized');
  assert.equal(na.occurrences, 2); // "N/A" and "n/a" normalize together
  assert.equal(na.resources, 2);
  const unknown = r.placeholders.find((p) => p.value === 'unknown')!;
  assert.equal(unknown.occurrences, 1);
});

test('placeholder counts: disjoint resources union correctly (no per-value max)', () => {
  // three resources, three different placeholder values, no overlap:
  // a per-value maximum would report 1 resource; the union is 3
  const r = run(
    `${HEADERS}\n` +
      `i-a,EC2,100,n/a,payments,prod,CC-1\n` +
      `i-b,EC2,100,anna,unknown,prod,CC-1\n` +
      `i-c,EC2,100,anna,payments,tbd,CC-1\n` +
      `i-ok,EC2,100,anna,payments,prod,CC-1`,
  );
  assert.equal(r.placeholderOccurrenceCount, 3);
  assert.equal(r.placeholderResourceCount, 3);
  assert.equal(r.placeholders.length, 3);
  for (const p of r.placeholders) assert.equal(p.resources, 1);
});

test('placeholder counts: multiple placeholders on one resource count once as a resource', () => {
  const r = run(
    `${HEADERS}\n` + `i-multi,EC2,100,n/a,unknown,tbd,CC-1\n` + `i-ok,EC2,100,anna,payments,prod,CC-1`,
  );
  assert.equal(r.placeholderOccurrenceCount, 3, 'three tag-value occurrences');
  assert.equal(r.placeholderResourceCount, 1, 'on a single resource');
});

test('placeholder counts: mixed overlap — occurrences and distinct resources both exact', () => {
  // i-a: n/a + unknown (2 occ) · i-b: n/a (1 occ) -> 3 occurrences, 2 resources
  const r = run(
    `${HEADERS}\n` +
      `i-a,EC2,100,n/a,unknown,prod,CC-1\n` +
      `i-b,EC2,100,n/a,payments,prod,CC-1\n` +
      `i-ok,EC2,100,anna,payments,prod,CC-1`,
  );
  assert.equal(r.placeholderOccurrenceCount, 3);
  assert.equal(r.placeholderResourceCount, 2);
  const na = r.placeholders.find((p) => p.value === 'n/a')!;
  assert.equal(na.occurrences, 2);
  assert.equal(na.resources, 2);
  const unknown = r.placeholders.find((p) => p.value === 'unknown')!;
  assert.equal(unknown.occurrences, 1);
  assert.equal(unknown.resources, 1);
});

test('genuinely empty cells are missing but NOT counted as placeholders', () => {
  const r = run(`${HEADERS}\ni-empty,EC2,100,,,,\ni-ok,EC2,100,anna,payments,prod,CC-1`);
  assert.equal(r.nonCompliantResourceCount, 1);
  assert.equal(r.placeholders.length, 0);
  assert.equal(r.placeholderOccurrenceCount, 0);
  assert.equal(r.placeholderResourceCount, 0);
  const owner = r.perTag.find((t) => t.key === 'owner')!;
  assert.equal(owner.missingCount, 1);
  assert.equal(owner.placeholderCount, 0);
});

test('aggregation: a real value on any line item wins over a placeholder on another', () => {
  // documented behavior: resource-level aggregation keeps the real value
  const r = run(
    `${HEADERS}\n` +
      `i-mixed,EC2,50,anna,payments,prod,CC-1\n` +
      `i-mixed,EC2,50,n/a,payments,prod,CC-1`,
  );
  assert.equal(r.analyzedResources, 1);
  assert.equal(r.compliantResourceCount, 1);
  assert.equal(r.placeholders.length, 0, 'the resolved resource holds no placeholder');
});

test('closely aligned scores: no divergence callout', () => {
  // 2 of 4 compliant (50%), compliant resources carry 55% of spend
  const r = run(
    `${HEADERS}\n` +
      `i-ok1,EC2,55,anna,payments,prod,CC-1\n` +
      `i-ok2,EC2,55,anna,payments,prod,CC-1\n` +
      `i-bad1,EC2,45,,,,\n` +
      `i-bad2,EC2,45,,,,`,
  );
  assert.equal(r.resourceCountScore, 50);
  assert.equal(r.costWeightedScore, 55);
  assert.ok(!diverges(r), 'a 5-point gap must not trigger the callout');
});

test('no-cost file: spend grade null, resource grade present, no divergence', () => {
  const r = run(
    `resource_id,owner,team,env,cost_center\n` +
      `r1,anna,payments,prod,CC-1\n` +
      `r2,anna,payments,prod,CC-1\n` +
      `r3,,,,`,
  );
  assert.equal(r.costWeightedScore, null);
  assert.equal(r.spendGrade, null);
  assert.equal(r.resourceCountScore, 66.67);
  assert.equal(r.resourceGrade, 'D');
  assert.ok(!diverges(r));
});
