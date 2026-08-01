import type { ParseResult } from './types.ts';

/**
 * Dependency-free CSV parser.
 * - RFC 4180 quote handling ("" escapes inside quoted fields)
 * - Delimiter auto-detection: , ; \t |
 * - BOM stripping, CRLF/CR/LF line endings
 * - Rows with a column count different from the header are skipped and reported
 */

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

export function detectDelimiter(text: string): string {
  // Count candidate delimiters outside quotes in the first ~10 lines,
  // pick the one with the highest consistent per-line count.
  const lines = firstLines(text, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length === 0) continue;
    // consistency: majority of lines share the same count
    const freq = new Map<number, number>();
    for (const c of nonZero) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [modeCount, modeFreq] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const score = modeFreq * 100 + modeCount; // prefer consistency, then more columns
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function firstLines(text: string, n: number): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length && out.length < n; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (i > start) out.push(text.slice(start, i));
      if (ch === '\r' && text[i + 1] === '\n') i++;
      start = i + 1;
    }
  }
  if (start < text.length && out.length < n) out.push(text.slice(start));
  return out.filter((l) => l.trim().length > 0);
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

export interface StreamHandlers {
  /** called once with trimmed headers; return false to abort */
  onHeaders?: (headers: string[]) => void | boolean;
  /** called per valid data row (1-based index); return false to abort */
  onRow: (row: string[], rowIndex: number) => void | boolean;
  /** called per malformed row (column-count mismatch, 1-based index) */
  onSkip?: (rowIndex: number) => void;
}

export interface StreamStats {
  headers: string[];
  delimiter: string;
  rowCount: number;
  skippedCount: number;
  aborted: boolean;
}

/**
 * Single-pass streaming CSV walk. Rows are handed to the callback and
 * discarded — memory stays flat regardless of file size (the input string
 * itself is the only large allocation). parseCsv() below materializes
 * arrays on top of this for small files / tests.
 */
export function streamCsv(input: string, handlers: StreamHandlers, delimiter?: string): StreamStats {
  // strip BOM
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const delim = delimiter ?? detectDelimiter(text);

  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let headers: string[] | null = null;
  let dataIndex = 0;
  let rowCount = 0;
  let skippedCount = 0;
  let aborted = false;

  const emit = (): boolean => {
    // returns false to abort the walk
    record.push(field);
    field = '';
    const rec = record;
    record = [];
    if (rec.length === 1 && rec[0].trim() === '') return true; // blank line
    if (headers === null) {
      headers = rec.map((h) => h.trim());
      return handlers.onHeaders?.(headers) !== false;
    }
    dataIndex++;
    if (rec.length !== headers.length) {
      skippedCount++;
      handlers.onSkip?.(dataIndex);
      return true;
    }
    rowCount++;
    return handlers.onRow(rec, dataIndex) !== false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === delim) {
        record.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (!emit()) {
          aborted = true;
          break;
        }
      } else {
        field += ch;
      }
    }
  }
  if (!aborted && (field !== '' || record.length > 0)) {
    if (!emit()) aborted = true;
  }

  return { headers: headers ?? [], delimiter: delim, rowCount, skippedCount, aborted };
}

/** Materializing parser for small files and tests. */
export function parseCsv(input: string, delimiter?: string): ParseResult {
  const rows: string[][] = [];
  const skippedRows: number[] = [];
  const stats = streamCsv(
    input,
    {
      onRow: (row) => {
        rows.push(row);
      },
      onSkip: (n) => {
        skippedRows.push(n);
      },
    },
    delimiter,
  );
  return { headers: stats.headers, rows, delimiter: stats.delimiter, skippedRows };
}

/** First N data rows (plus headers) — used to run column detection cheaply. */
export function sampleCsv(input: string, n = 500): { headers: string[]; rows: string[][]; delimiter: string } {
  const rows: string[][] = [];
  const stats = streamCsv(input, {
    onRow: (row) => {
      rows.push(row);
      return rows.length < n;
    },
  });
  return { headers: stats.headers, rows, delimiter: stats.delimiter };
}

/** Convenience: row array -> object keyed by header */
export function rowToObject(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] ?? '';
  return obj;
}

/**
 * Parse a cost cell: strips currency symbols, thousands separators, spaces.
 * Supports "(123.45)" accounting-style negatives and "1.234,56" EU format
 * (heuristic: if both . and , present, the rightmost is the decimal separator).
 * Returns undefined for unparseable values.
 */
export function parseCost(raw: string | undefined | null): number | undefined {
  if (raw == null) return undefined;
  let s = raw.trim();
  if (s === '') return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  // strip currency symbols, letters (USD), spaces
  s = s.replace(/[^\d.,]/g, '');
  if (s === '') return undefined;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // EU: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // only commas: decimal if exactly one comma with 1-2 decimals, else thousands
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) s = parts.join('.');
    else s = parts.join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}
