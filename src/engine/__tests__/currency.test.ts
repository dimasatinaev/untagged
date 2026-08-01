import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../csv.ts';
import { detectColumns } from '../detect.ts';
import { analyze, normalizeCurrency } from '../analyze.ts';
import { DEFAULT_POLICY } from '../policy.ts';

/**
 * Currency safety: summing amounts across currencies is financially wrong.
 * The engine reports every currency seen across the FULL pass; the UI refuses
 * to render a report when more than one is present.
 */

const HEADERS = 'resource_id,service,monthly_cost,currency,owner,team,env,cost_center';

function run(csv: string) {
  const parsed = parseCsv(csv);
  const { mapping } = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  return { mapping, result: analyze(parsed, mapping, DEFAULT_POLICY) };
}

test('currency column is auto-detected', () => {
  const { mapping } = run(`${HEADERS}\nr1,EC2,100,USD,anna,payments,prod,CC-1`);
  assert.equal(mapping.currency, 'currency');
});

test('single currency: reported once, normalized', () => {
  const { result } = run(
    `${HEADERS}\nr1,EC2,100,usd,anna,payments,prod,CC-1\nr2,EC2,50, USD ,anna,payments,prod,CC-1`,
  );
  assert.deepEqual(result.currencies, ['USD']);
});

test('mixed currencies: all reported so the UI can refuse the report', () => {
  const { result } = run(
    `${HEADERS}\nr1,EC2,100,USD,anna,payments,prod,CC-1\nr2,EC2,50,EUR,anna,payments,prod,CC-1\nr3,EC2,10,GBP,anna,payments,prod,CC-1`,
  );
  assert.deepEqual(result.currencies, ['EUR', 'GBP', 'USD']);
});

test('mixed currency appearing AFTER the 500-row detection sample is still caught', () => {
  const rows = ['r' + 0 + ',EC2,10,USD,anna,payments,prod,CC-1'];
  for (let i = 1; i < 600; i++) rows.push(`r${i},EC2,10,USD,anna,payments,prod,CC-1`);
  rows.push('r-last,EC2,10,EUR,anna,payments,prod,CC-1'); // row 601
  const { result } = run(`${HEADERS}\n${rows.join('\n')}`);
  assert.deepEqual(result.currencies, ['EUR', 'USD']);
});

test('missing currency column: currencies is empty', () => {
  const parsed = parseCsv(`resource_id,service,monthly_cost,owner,team,env,cost_center\nr1,EC2,100,anna,payments,prod,CC-1`);
  const { mapping } = detectColumns(parsed.headers, DEFAULT_POLICY, parsed.rows);
  const result = analyze(parsed, mapping, DEFAULT_POLICY);
  assert.equal(mapping.currency, undefined);
  assert.deepEqual(result.currencies, []);
});

test('empty/placeholder currency cells are ignored, not treated as a second currency', () => {
  const { result } = run(
    `${HEADERS}\nr1,EC2,100,USD,anna,payments,prod,CC-1\nr2,EC2,50,,anna,payments,prod,CC-1\nr3,EC2,10,n/a,anna,payments,prod,CC-1`,
  );
  assert.deepEqual(result.currencies, ['USD']);
});

test('normalizeCurrency basics', () => {
  assert.equal(normalizeCurrency(' usd '), 'USD');
  assert.equal(normalizeCurrency('EUR'), 'EUR');
  assert.equal(normalizeCurrency(''), null);
  assert.equal(normalizeCurrency('n/a'), null);
  assert.equal(normalizeCurrency(undefined), null);
});
