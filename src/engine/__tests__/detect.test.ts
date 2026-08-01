import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, stripTagPrefix, normalizeHeader } from '../detect.ts';
import { DEFAULT_POLICY } from '../policy.ts';

test('detects generic headers', () => {
  const d = detectColumns(
    ['resource_id', 'service', 'cloud_provider', 'region', 'monthly_cost', 'owner', 'team', 'env', 'cost_center'],
    DEFAULT_POLICY,
  );
  assert.equal(d.mapping.resourceId, 'resource_id');
  assert.equal(d.mapping.cost, 'monthly_cost');
  assert.equal(d.mapping.provider, 'cloud_provider');
  assert.equal(d.mapping.tagColumns['owner'], 'owner');
  assert.equal(d.mapping.tagColumns['environment'], 'env');
  assert.equal(d.mapping.tagColumns['cost_center'], 'cost_center');
  assert.ok(d.confidence >= 0.9);
});

test('detects AWS-style prefixed tag columns', () => {
  const d = detectColumns(
    ['lineItem/ResourceId', 'lineItem/UnblendedCost', 'user:Team', 'user:Environment', 'user:CostCenter'],
    DEFAULT_POLICY,
  );
  assert.equal(d.preset, 'aws-cur');
  assert.equal(d.mapping.resourceId, 'lineItem/ResourceId');
  assert.equal(d.mapping.cost, 'lineItem/UnblendedCost');
  assert.equal(d.mapping.tagColumns['team'], 'user:Team');
  assert.equal(d.mapping.tagColumns['environment'], 'user:Environment');
  assert.equal(d.mapping.tagColumns['cost_center'], 'user:CostCenter');
});

test('detects Azure preset', () => {
  const d = detectColumns(
    ['ResourceId', 'MeterCategory', 'ResourceLocation', 'PreTaxCost', 'tags/owner'],
    DEFAULT_POLICY,
  );
  assert.equal(d.preset, 'azure-cost-mgmt');
  assert.equal(d.mapping.service, 'MeterCategory');
  assert.equal(d.mapping.cost, 'PreTaxCost');
  assert.equal(d.mapping.tagColumns['owner'], 'tags/owner');
});

test('notes missing cost column', () => {
  const d = detectColumns(['resource_id', 'owner', 'team'], DEFAULT_POLICY);
  assert.equal(d.mapping.cost, undefined);
  assert.ok(d.notes.some((n) => n.includes('resource-count only')));
});

test('does not map one column to two roles', () => {
  const d = detectColumns(['id', 'cost'], DEFAULT_POLICY);
  assert.equal(d.mapping.resourceId, 'id');
  assert.equal(d.mapping.cost, 'cost');
  const used = [d.mapping.resourceId, d.mapping.cost];
  assert.equal(new Set(used).size, used.length);
});

test('stripTagPrefix variants', () => {
  assert.equal(stripTagPrefix('user:Team'), 'Team');
  assert.equal(stripTagPrefix('tag:env'), 'env');
  assert.equal(stripTagPrefix('tags/owner'), 'owner');
  assert.equal(stripTagPrefix('resourceTags/user:CostCenter'), 'CostCenter');
  assert.equal(stripTagPrefix('label:team'), 'team');
  assert.equal(stripTagPrefix('plain'), 'plain');
});

test('normalizeHeader strips separators and case', () => {
  assert.equal(normalizeHeader('Cost-Center'), 'costcenter');
  assert.equal(normalizeHeader('cost_center'), 'costcenter');
  assert.equal(normalizeHeader('Cost Center'), 'costcenter');
});
