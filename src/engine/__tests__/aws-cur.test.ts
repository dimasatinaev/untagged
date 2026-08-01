import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../csv.ts';
import { detectColumns, stripTagPrefix } from '../detect.ts';
import { analyze } from '../analyze.ts';
import { DEFAULT_POLICY } from '../policy.ts';

/**
 * Legacy AWS CUR format test.
 * Fixture: mock rows built to the exact schema of the AWS Well-Architected
 * Labs workshop CUR dataset (column list verified from
 * NicolasBohorquez/CUR-Sample-files create-sqlite-table.sql), using the raw
 * CSV header style ("lineItem/UnblendedCost", "resourceTags/user:cost_center").
 * Real-world properties covered: Tax/Credit/RIFee line item types, rows with
 * no resource id, tag columns behind resourceTags/user: prefixes,
 * "department" as the team tag, env value drift (Prod/prod/production/prd).
 */

const csvPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'samples', 'aws-cur-sample.csv');
const csv = readFileSync(csvPath, 'utf8');

test('CUR: preset and roles detected', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  assert.equal(d.preset, 'aws-cur');
  assert.equal(d.mapping.resourceId, 'lineItem/ResourceId');
  assert.equal(d.mapping.cost, 'lineItem/UnblendedCost');
  assert.equal(d.mapping.region, 'product/region');
  assert.equal(d.mapping.currency, 'lineItem/CurrencyCode');
  // service grouping must use the human-readable product name
  assert.equal(d.mapping.service, 'product/ProductName');
});

test('CUR: prefixed tag columns mapped to mandatory tags', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  assert.equal(d.mapping.tagColumns['cost_center'], 'resourceTags/user:cost_center');
  assert.equal(d.mapping.tagColumns['environment'], 'resourceTags/user:environment');
  // "department" maps to team
  assert.equal(d.mapping.tagColumns['team'], 'resourceTags/user:department');
  // no owner tag in this schema — correctly unmapped
  assert.equal(d.mapping.tagColumns['owner'], undefined);
});

test('CUR: Tax/Credit/RIFee rows classified untaggable, never "fixable"', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  assert.equal(d.mapping.chargeType, 'lineItem/LineItemType');
  const r = analyze(parsed, d.mapping, DEFAULT_POLICY);
  // Tax + Credit + RIFee rows -> untaggable bucket
  assert.equal(r.untaggableCount, 3);
  assert.equal(r.creditCount, 0);
  // 15 rows - 3 untaggable
  assert.equal(r.analyzedResources, 12);
  assert.equal(r.duplicateIdCount, 0);
  // score improves once untaggable charges stop counting against coverage
  assert.ok(r.costWeightedScore! > 55 && r.costWeightedScore! < 70, `score ${r.costWeightedScore}`);
  // tax row (no resource id) must NOT be an offender
  assert.ok(!r.offenders.some((o) => /^row-\d+$/.test(o.id) && o.service?.includes('Compute')), 'no tax-row offender');
  assert.ok(r.offenders.length >= 2); // tmp bucket, t2.micro, EBS volume
});

test('CUR: env value drift detected (Prod/prod/production/prd)', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  const r = analyze(parsed, d.mapping, DEFAULT_POLICY);
  const envDrift = r.drift.filter((f) => f.type === 'value' && f.tagKey === 'environment');
  assert.ok(envDrift.length >= 1, `expected env drift, got ${JSON.stringify(r.drift)}`);
});

test('stripTagPrefix: Athena-style underscore prefixes', () => {
  assert.equal(stripTagPrefix('resource_tags_user_cost_center'), 'cost_center');
  assert.equal(stripTagPrefix('resource_tags_user_environment'), 'environment');
  assert.equal(stripTagPrefix('resourceTags/user:CostCenter'), 'CostCenter');
});

test('CUR: Athena-normalized headers also map', () => {
  const d = detectColumns(
    [
      'line_item_resource_id',
      'line_item_unblended_cost',
      'product_region',
      'resource_tags_user_cost_center',
      'resource_tags_user_environment',
      'resource_tags_user_department',
    ],
    DEFAULT_POLICY,
  );
  assert.equal(d.preset, 'aws-cur');
  assert.equal(d.mapping.resourceId, 'line_item_resource_id');
  assert.equal(d.mapping.cost, 'line_item_unblended_cost');
  assert.equal(d.mapping.tagColumns['cost_center'], 'resource_tags_user_cost_center');
  assert.equal(d.mapping.tagColumns['environment'], 'resource_tags_user_environment');
  assert.equal(d.mapping.tagColumns['team'], 'resource_tags_user_department');
});
