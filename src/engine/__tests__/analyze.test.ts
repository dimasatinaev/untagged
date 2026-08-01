import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../csv.ts';
import { detectColumns } from '../detect.ts';
import { analyze } from '../analyze.ts';
import { DEFAULT_POLICY } from '../policy.ts';
import { generateDemoCsv } from '../../data/demo.ts';

const HEADERS = 'resource_id,service,monthly_cost,owner,team,env,cost_center';

function run(csv: string) {
  const parsed = parseCsv(csv);
  const { mapping } = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  return analyze(parsed, mapping, DEFAULT_POLICY);
}

test('fully tagged file scores 100 / grade A', () => {
  const r = run(`${HEADERS}\nr1,EC2,100,anna,payments,prod,CC-1\nr2,S3,50,tomas,search,dev,CC-2`);
  assert.equal(r.costWeightedScore, 100);
  assert.equal(r.resourceCountScore, 100);
  assert.equal(r.grade, 'A');
  assert.equal(r.unallocatedCost, 0);
  assert.equal(r.offenders.length, 0);
});

test('cost-weighted vs count scores differ correctly', () => {
  // r1 compliant $900, r2 non-compliant $100 -> cost 90%, count 50%
  const r = run(`${HEADERS}\nr1,EC2,900,anna,payments,prod,CC-1\nr2,EC2,100,,payments,prod,CC-1`);
  assert.equal(r.costWeightedScore, 90);
  assert.equal(r.resourceCountScore, 50);
  assert.equal(r.unallocatedCost, 100);
  assert.equal(r.grade, 'B'); // headline = cost-weighted 90
});

test('null tokens count as missing', () => {
  const r = run(`${HEADERS}\nr1,EC2,100,n/a,payments,prod,CC-1\nr2,EC2,100,-,payments,prod,CC-1\nr3,EC2,100,anna,payments,prod,CC-1`);
  const owner = r.perTag.find((t) => t.key === 'owner')!;
  assert.equal(owner.missingCount, 2);
  assert.equal(r.resourceCountScore, 33.33);
});

test('unattached negative line items are credits, excluded from cost math', () => {
  // credit row has NO resource id -> account-level credit
  const r = run(`${HEADERS}\nr1,EC2,100,anna,payments,prod,CC-1\n,EC2,-40,,,,`);
  assert.equal(r.creditCount, 1);
  assert.equal(r.creditTotal, -40);
  assert.equal(r.totalCost, 100);
  assert.equal(r.costWeightedScore, 100);
});

test('attached negative line items are NETTED into their resource', () => {
  const r = run(`${HEADERS}\nr1,EC2,100,anna,payments,prod,CC-1\nr1,EC2,-30,anna,payments,prod,CC-1`);
  assert.equal(r.creditCount, 0);
  assert.equal(r.nettedCreditCount, 1);
  assert.equal(r.totalCost, 70);
  assert.equal(r.analyzedResources, 1);
});

test('net-negative resources are clamped to 0 with a count', () => {
  const r = run(`${HEADERS}\nr1,EC2,10,anna,payments,prod,CC-1\nr1,EC2,-50,anna,payments,prod,CC-1\nr2,EC2,100,anna,payments,prod,CC-1`);
  assert.equal(r.negativeResourceCount, 1);
  assert.equal(r.totalCost, 100); // r1 clamped to 0
  assert.equal(r.costWeightedScore, 100);
});

test('line items with same resource id are AGGREGATED (costs summed)', () => {
  const r = run(`${HEADERS}\nr1,EC2,100,anna,payments,prod,CC-1\nr1,EC2,80,anna,payments,prod,CC-1`);
  assert.equal(r.duplicateIdCount, 1); // one merged line item
  assert.equal(r.analyzedResources, 1);
  assert.equal(r.totalCost, 180); // summed, not max
});

test('aggregation is case-insensitive on resource id (Azure casing variance)', () => {
  const r = run(
    `${HEADERS}\n/SUBSCRIPTIONS/ABC/VM1,VM,100,anna,payments,prod,CC-1\n/subscriptions/abc/vm1,VM,50,anna,payments,prod,CC-1`,
  );
  assert.equal(r.analyzedResources, 1);
  assert.equal(r.duplicateIdCount, 1);
  assert.equal(r.totalCost, 150);
});

test('aggregation: tag from any line item counts; null token never overwrites real value', () => {
  // r1 appears 3x: first row missing owner, second has it, third has "n/a"
  const r = run(
    `${HEADERS}\nr1,EC2,10,,payments,prod,CC-1\nr1,EC2,10,anna,payments,prod,CC-1\nr1,EC2,10,n/a,payments,prod,CC-1`,
  );
  assert.equal(r.analyzedResources, 1);
  assert.equal(r.resourceCountScore, 100); // owner found on one line item
  assert.equal(r.offenders.length, 0);
});

test('no cost column -> count-only mode', () => {
  const r = run(`resource_id,owner,team,env,cost_center\nr1,anna,payments,prod,CC-1\nr2,,payments,prod,CC-1`);
  assert.equal(r.costWeightedScore, null);
  assert.equal(r.resourceCountScore, 50);
  assert.equal(r.grade, 'D'); // headline falls back to count score
});

test('unparseable costs counted, treated as zero', () => {
  const r = run(`${HEADERS}\nr1,EC2,oops,anna,payments,prod,CC-1\nr2,EC2,100,anna,payments,prod,CC-1`);
  assert.equal(r.costMissingCount, 1);
  assert.equal(r.totalCost, 100);
});

test('offenders sorted by cost desc', () => {
  const r = run(`${HEADERS}\nr1,EC2,10,,payments,prod,CC-1\nr2,EC2,500,,payments,prod,CC-1\nr3,EC2,100,,payments,prod,CC-1`);
  assert.deepEqual(r.offenders.map((o) => o.id), ['r2', 'r3', 'r1']);
});

test('byService aggregates unallocated cost', () => {
  const r = run(`${HEADERS}\nr1,EC2,100,,payments,prod,CC-1\nr2,S3,50,anna,search,dev,CC-2\nr3,EC2,200,anna,payments,prod,CC-1`);
  const ec2 = r.byService.find((s) => s.service === 'EC2')!;
  assert.equal(ec2.totalCost, 300);
  assert.equal(ec2.unallocatedCost, 100);
  assert.equal(ec2.nonCompliantCount, 1);
  // sorted by unallocated desc -> EC2 first
  assert.equal(r.byService[0].service, 'EC2');
});

test('zero rows -> resourceCountScore 100 (vacuous), no crash', () => {
  const r = run(`${HEADERS}`);
  assert.equal(r.analyzedResources, 0);
  assert.equal(r.resourceCountScore, 100);
});

test('solo-recoverable cost: only resources missing exactly one tag count', () => {
  // r1 misses only env ($100), r2 misses env+owner ($50), r3 compliant
  const r = run(
    `${HEADERS}\nr1,EC2,100,anna,payments,,CC-1\nr2,EC2,50,,payments,,CC-1\nr3,EC2,10,anna,payments,prod,CC-1`,
  );
  const env = r.perTag.find((t) => t.key === 'environment')!;
  const owner = r.perTag.find((t) => t.key === 'owner')!;
  assert.equal(env.soloRecoverableCost, 100); // r2 needs two fixes, doesn't count
  assert.equal(owner.soloRecoverableCost, 0);
});

test('resource labeled by dominant-cost service, not first line item', () => {
  // vm1: first line item is Bandwidth ($5), but VM hours dominate ($100)
  const r = run(
    `${HEADERS}\nvm1,Bandwidth,5,anna,payments,prod,CC-1\nvm1,Virtual Machines,100,anna,payments,prod,CC-1\nvm1,Storage,2,anna,payments,prod,CC-1`,
  );
  assert.equal(r.analyzedResources, 1);
  assert.equal(r.byService.length, 1);
  assert.equal(r.byService[0].service, 'Virtual Machines');
  assert.equal(r.byService[0].totalCost, 107);
});

test('grade bands', () => {
  const mk = (compliantCost: number) =>
    run(`${HEADERS}\nok,EC2,${compliantCost},anna,payments,prod,CC-1\nbad,EC2,${100 - compliantCost},,,,`);
  assert.equal(mk(96).grade, 'A');
  assert.equal(mk(90).grade, 'B');
  assert.equal(mk(75).grade, 'C');
  assert.equal(mk(55).grade, 'D');
  assert.equal(mk(30).grade, 'F');
});

test('demo dataset flows through full pipeline with expected characteristics', () => {
  const csv = generateDemoCsv(200);
  const parsed = parseCsv(csv);
  const { mapping, preset, notes } = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  assert.equal(preset, 'generic');
  // ambiguity between env/Environment must be surfaced and resolved to "env"
  assert.equal(mapping.tagColumns['environment'], 'env');
  assert.ok(notes.some((n) => n.includes('Environment')));
  const r = analyze(parsed, mapping, DEFAULT_POLICY);
  assert.ok(r.analyzedResources > 190, `analyzed ${r.analyzedResources}`);
  assert.equal(r.creditCount, 1);
  assert.equal(r.duplicateIdCount, 1);
  // engineered to be imperfect but not catastrophic
  assert.ok(r.costWeightedScore! > 30 && r.costWeightedScore! < 90, `score ${r.costWeightedScore}`);
  assert.ok(r.drift.length >= 2, `drift findings: ${r.drift.length}`);
  assert.ok(r.offenders.length > 0);
  // the engineered fat offender is on top
  assert.equal(r.offenders[0].id, 'i-0deadbeef');
});
