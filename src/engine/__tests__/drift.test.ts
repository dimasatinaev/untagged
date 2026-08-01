import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKeyDrift, detectValueDrift, levenshtein } from '../drift.ts';
import { DEFAULT_POLICY } from '../policy.ts';
import type { Resource } from '../types.ts';

function res(tags: Record<string, string>): Resource {
  return { id: 'r' + Math.random(), tags };
}

test('key drift: env + Environment both match environment tag', () => {
  const findings = detectKeyDrift(['resource_id', 'env', 'Environment', 'cost'], DEFAULT_POLICY);
  const envFinding = findings.find((f) => f.tagKey === 'environment');
  assert.ok(envFinding, 'expected environment key-drift finding');
  assert.deepEqual([...envFinding!.members].sort(), ['Environment', 'env']);
});

test('key drift: normalization duplicates (Cost-Center vs cost_center)', () => {
  const findings = detectKeyDrift(['Cost-Center', 'cost_center'], DEFAULT_POLICY);
  assert.ok(findings.length >= 1);
  assert.ok(findings[0].members.includes('Cost-Center'));
});

test('no key drift on clean headers', () => {
  const findings = detectKeyDrift(['resource_id', 'owner', 'team', 'env', 'cost_center'], DEFAULT_POLICY);
  assert.equal(findings.length, 0);
});

test('value drift: case variants', () => {
  const rs = [res({ environment: 'prod' }), res({ environment: 'PROD' }), res({ environment: 'Prod' })];
  const findings = detectValueDrift(rs, 'environment', DEFAULT_POLICY);
  assert.ok(findings.some((f) => f.suggestion.includes('Case/format variants')));
});

test('value drift: env aliases prod/production', () => {
  const rs = [res({ environment: 'prod' }), res({ environment: 'production' })];
  const findings = detectValueDrift(rs, 'environment', DEFAULT_POLICY);
  assert.ok(findings.some((f) => f.suggestion.includes('same environment')));
});

test('value drift: token order (payments-team vs team-payments)', () => {
  const rs = [res({ team: 'payments-team' }), res({ team: 'team-payments' })];
  const findings = detectValueDrift(rs, 'team', DEFAULT_POLICY);
  assert.ok(findings.some((f) => f.suggestion.includes('different order')));
});

test('value drift: one-character typo', () => {
  const rs = [res({ team: 'platform' }), res({ team: 'plaform' })];
  const findings = detectValueDrift(rs, 'team', DEFAULT_POLICY);
  assert.ok(findings.some((f) => f.suggestion.includes('one character')));
});

test('sequential codes are not typo drift (CC-1042 vs CC-1043)', () => {
  const rs = [res({ cost_center: 'CC-1042' }), res({ cost_center: 'CC-1043' })];
  const findings = detectValueDrift(rs, 'cost_center', DEFAULT_POLICY);
  assert.equal(findings.length, 0);
});

test('no value drift on distinct clean values', () => {
  const rs = [res({ team: 'payments' }), res({ team: 'search' }), res({ team: 'data-platform' })];
  const findings = detectValueDrift(rs, 'team', DEFAULT_POLICY);
  assert.equal(findings.length, 0);
});

test('null tokens do not participate in value drift', () => {
  const rs = [res({ team: 'n/a' }), res({ team: 'N/A' }), res({ team: 'payments' })];
  const findings = detectValueDrift(rs, 'team', DEFAULT_POLICY);
  assert.equal(findings.length, 0);
});

test('levenshtein basics', () => {
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', 'abd'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});
