import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCost, detectDelimiter } from '../csv.ts';

test('parses simple csv', () => {
  const r = parseCsv('a,b,c\n1,2,3\n4,5,6');
  assert.deepEqual(r.headers, ['a', 'b', 'c']);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], ['1', '2', '3']);
  assert.deepEqual(r.skippedRows, []);
});

test('handles quoted fields with commas, escaped quotes, newlines', () => {
  const r = parseCsv('name,note\n"Smith, Anna","said ""hi""\nsecond line"');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0][0], 'Smith, Anna');
  assert.equal(r.rows[0][1], 'said "hi"\nsecond line');
});

test('strips BOM and handles CRLF', () => {
  const r = parseCsv('﻿a,b\r\n1,2\r\n');
  assert.deepEqual(r.headers, ['a', 'b']);
  assert.equal(r.rows.length, 1);
});

test('detects semicolon and tab delimiters', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  const r = parseCsv('a;b\n1;2');
  assert.deepEqual(r.headers, ['a', 'b']);
});

test('skips malformed rows and reports them', () => {
  const r = parseCsv('a,b,c\n1,2,3\nonly,two\n4,5,6');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.skippedRows, [2]);
});

test('empty input and headers-only input', () => {
  assert.equal(parseCsv('').rows.length, 0);
  const r = parseCsv('a,b,c');
  assert.deepEqual(r.headers, ['a', 'b', 'c']);
  assert.equal(r.rows.length, 0);
});

test('ignores blank lines', () => {
  const r = parseCsv('a,b\n1,2\n\n\n3,4\n');
  assert.equal(r.rows.length, 2);
});

test('parseCost: plain, currency, thousands, negatives, EU format', () => {
  assert.equal(parseCost('123.45'), 123.45);
  assert.equal(parseCost('$1,234.56'), 1234.56);
  assert.equal(parseCost('1.234,56'), 1234.56);
  assert.equal(parseCost('(50.00)'), -50);
  assert.equal(parseCost('-12'), -12);
  assert.equal(parseCost('0'), 0);
  assert.equal(parseCost('1,234'), 1234); // thousands, not decimal
  assert.equal(parseCost('12,5'), 12.5); // single comma decimal
  assert.equal(parseCost('EUR 99.90'), 99.9);
  assert.equal(parseCost(''), undefined);
  assert.equal(parseCost('abc'), undefined);
  assert.equal(parseCost(undefined), undefined);
});
