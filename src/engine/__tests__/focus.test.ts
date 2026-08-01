import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../csv.ts';
import { detectColumns } from '../detect.ts';
import { analyze } from '../analyze.ts';
import { DEFAULT_POLICY } from '../policy.ts';

/**
 * Regression test against REAL FOCUS 1.0 data.
 * Fixture: 30 rows taken verbatim from the FinOps Foundation's focus_validator
 * sample dataset (finopsfoundation/focus_validator, tests/samples/focus_sample_10000.csv).
 * Notable real-world properties: tags as a JSON column, literal NULL strings,
 * NULL resource ids, duplicate resource ids, 11-decimal costs, quoted headers.
 */

const csvPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'samples', 'focus-sample.csv');
const csv = readFileSync(csvPath, 'utf8');

test('FOCUS: parses fully, no skipped rows', () => {
  const parsed = parseCsv(csv);
  assert.equal(parsed.headers.length, 44);
  assert.equal(parsed.rows.length, 30);
  assert.deepEqual(parsed.skippedRows, []);
});

test('FOCUS: preset and core roles detected', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  assert.equal(d.preset, 'focus');
  assert.equal(d.mapping.resourceId, 'ResourceId');
  assert.equal(d.mapping.cost, 'BilledCost');
  assert.equal(d.mapping.service, 'ServiceName');
  assert.equal(d.mapping.provider, 'ProviderName');
  assert.equal(d.mapping.region, 'RegionId');
});

test('FOCUS: JSON tag column detected and environment mapped from JSON keys', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  assert.equal(d.mapping.jsonTagColumn, 'Tags');
  assert.equal(d.mapping.jsonTagKeys?.['environment'], 'environment');
  assert.ok(d.notes.some((n) => n.includes('JSON')));
});

test('FOCUS: analysis — NULL ids synthesized, duplicates deduped, sane coverage', () => {
  const parsed = parseCsv(csv);
  const d = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  const r = analyze(parsed, d.mapping, DEFAULT_POLICY);

  // 30 rows, two genuine duplicate ResourceId pairs (i-0b8298503llffff97 and
  // the terraborc RDS ARN — the same resource billed in multiple periods)
  assert.equal(r.duplicateIdCount, 2);
  assert.equal(r.analyzedResources, 28);

  // environment + team (via business_unit) are trackable from this file's tags
  assert.equal(r.perTag.length, 2);
  const env = r.perTag.find((t) => t.key === 'environment')!;
  const team = r.perTag.find((t) => t.key === 'team')!;
  assert.ok(env, 'environment tracked');
  assert.ok(team, 'team tracked via business_unit');
  // partial coverage: some rows have Tags JSON, some are NULL
  assert.ok(env.resourcePct > 30 && env.resourcePct < 90, `env coverage ${env.resourcePct}`);

  // cost-weighted score exists and is a real percentage
  assert.ok(r.costWeightedScore !== null);
  assert.ok(r.costWeightedScore! > 0 && r.costWeightedScore! < 100, `score ${r.costWeightedScore}`);
  assert.ok(r.totalCost > 0);
  assert.ok(r.unallocatedCost > 0 && r.unallocatedCost <= r.totalCost);

  // no crash on byService; ServiceName populated
  assert.ok(r.byService.length >= 5);
});
