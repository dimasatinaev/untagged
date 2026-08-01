import { useMemo, useState } from 'react';
import type { AnalysisResult, Resource } from '../engine/types.ts';
import { DEFAULT_POLICY, isNullToken } from '../engine/policy.ts';
import { makeMoneyContext } from './money.ts';

interface Props {
  result: AnalysisResult;
  fileName: string;
  onBack: () => void;
}

const RENDER_CAP = 200;

type StatusFilter = 'all' | 'noncompliant' | 'compliant';
type SortKey = 'cost' | 'id' | 'service';

export default function ResourceExplorer({ result, fileName, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [missingTag, setMissingTag] = useState<string | null>(null);
  const [service, setService] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortDesc, setSortDesc] = useState(true);

  const trackedTags = result.perTag;
  const money = makeMoneyContext(result.currencies);
  const isMissing = (r: Resource, key: string) => isNullToken(r.tags[key], DEFAULT_POLICY);
  const isCompliant = (r: Resource) => trackedTags.every((t) => !isMissing(r, t.key));

  const services = useMemo(() => {
    const s = new Set<string>();
    for (const r of result.resources) s.add(r.service ?? '(no service)');
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [result.resources]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = result.resources.filter((r) => {
      if (q && !(r.id.toLowerCase().includes(q) || (r.service ?? '').toLowerCase().includes(q))) return false;
      if (status === 'noncompliant' && isCompliant(r)) return false;
      if (status === 'compliant' && !isCompliant(r)) return false;
      if (missingTag && !isMissing(r, missingTag)) return false;
      if (service && (r.service ?? '(no service)') !== service) return false;
      return true;
    });
    const dir = sortDesc ? -1 : 1;
    list = [...list].sort((a, b) => {
      if (sortKey === 'cost') return dir * ((a.cost ?? 0) - (b.cost ?? 0));
      if (sortKey === 'service') return dir * (a.service ?? '').localeCompare(b.service ?? '');
      return dir * a.id.localeCompare(b.id);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.resources, query, status, missingTag, service, sortKey, sortDesc]);

  const shown = filtered.slice(0, RENDER_CAP);
  const hasFilters = query !== '' || status !== 'all' || missingTag !== null || service !== '';

  function clearFilters() {
    setQuery('');
    setStatus('all');
    setMissingTag(null);
    setService('');
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(key === 'cost');
    }
  }

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDesc ? ' ↓' : ' ↑') : '');

  return (
    <section className="explorer">
      <div className="screen-heading">
        <span className="kicker">Explorer</span>
        <h2>All resources</h2>
        <p>
          <strong>{fileName}</strong> · {result.analyzedResources.toLocaleString()} resources
          {result.resourcesTruncated && (
            <span className="warn">
              {' '}
              · showing the top {result.resources.length.toLocaleString()} by cost (file has more)
            </span>
          )}
        </p>
      </div>

      {/* filter bar */}
      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search resource id or service…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search resources"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Compliance filter">
          <option value="all">All resources</option>
          <option value="noncompliant">Non-compliant only</option>
          <option value="compliant">Compliant only</option>
        </select>
        <select
          value={missingTag ?? ''}
          onChange={(e) => setMissingTag(e.target.value || null)}
          aria-label="Missing tag filter"
        >
          <option value="">Missing any/none…</option>
          {trackedTags.map((t) => (
            <option key={t.key} value={t.key}>
              Missing: {t.label}
            </option>
          ))}
        </select>
        <select value={service} onChange={(e) => setService(e.target.value)} aria-label="Service filter">
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button className="btn btn--ghost btn--small" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <p className="hint result-count" role="status">
        {filtered.length === result.resources.length
          ? `${filtered.length.toLocaleString()} resources`
          : `${filtered.length.toLocaleString()} of ${result.resources.length.toLocaleString()} resources match`}
        {filtered.length > RENDER_CAP && ` — showing the first ${RENDER_CAP} (refine filters to narrow down)`}
      </p>

      {/* table / states */}
      {filtered.length === 0 ? (
        <div className="card empty-state">
          {hasFilters ? (
            <>
              <p>
                <strong>No resources match these filters.</strong>
              </p>
              <p className="hint">Try a broader search, or clear the filters to see everything.</p>
              <button className="btn btn--ghost" onClick={clearFilters}>
                Clear all filters
              </button>
            </>
          ) : (
            <p className="hint">This file produced no analyzable resources.</p>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <button className="th-sort" onClick={() => toggleSort('id')}>
                      Resource{sortIndicator('id')}
                    </button>
                  </th>
                  <th>
                    <button className="th-sort" onClick={() => toggleSort('service')}>
                      Service{sortIndicator('service')}
                    </button>
                  </th>
                  <th className="num">
                    <button className="th-sort" onClick={() => toggleSort('cost')}>
                      Cost{sortIndicator('cost')}
                    </button>
                  </th>
                  <th className="num">Line items</th>
                  {trackedTags.map((t) => (
                    <th key={t.key}>{t.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={isCompliant(r) ? '' : 'row--noncompliant'}>
                    <td className="mono mono--truncate" title={r.id}>
                      {r.id}
                    </td>
                    <td>{r.service ?? '—'}</td>
                    <td className="num">{r.cost !== undefined ? money.fmt(r.cost) : '—'}</td>
                    <td className="num">{r.lineItems ?? 1}</td>
                    {trackedTags.map((t) =>
                      isMissing(r, t.key) ? (
                        <td key={t.key}>
                          <span className="badge badge--missing">missing</span>
                        </td>
                      ) : (
                        <td key={t.key}>{r.tags[t.key]}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="actions actions--sticky">
        <button className="btn btn--ghost" onClick={onBack}>
          ← Back to report
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            const costHeader = money.currency ? `cost_${money.currency.toLowerCase()}` : 'cost';
            const lines = [
              ['resource_id', 'service', costHeader, 'line_items', ...trackedTags.map((t) => t.key)].join(','),
              ...filtered.map((r) =>
                [
                  csvCell(r.id),
                  csvCell(r.service ?? ''),
                  r.cost ?? '',
                  r.lineItems ?? 1,
                  ...trackedTags.map((t) => csvCell(isMissing(r, t.key) ? '' : r.tags[t.key])),
                ].join(','),
              ),
            ];
            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'untagged-resources.csv';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Download filtered CSV ({filtered.length.toLocaleString()})
        </button>
      </div>
    </section>
  );
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
