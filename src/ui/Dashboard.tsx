import { useState } from 'react';
import type { Session } from '../App.tsx';
import type { AnalysisResult } from '../engine/types.ts';
import {
  SPEND_GRADE_LABELS,
  RESOURCE_GRADE_LABELS,
  DIVERGENCE_THRESHOLD_POINTS,
  DEFAULT_POLICY,
  isNullToken,
} from '../engine/policy.ts';
import { makeMoneyContext, type MoneyContext } from './money.ts';

interface Props {
  session: Session;
  result: AnalysisResult;
  onBack: () => void;
  onReset: () => void;
  onExplore: () => void;
}

/** negligible-cost threshold for the fix-first list */
const NEGLIGIBLE = 0.01;

function isSyntheticId(id: string): boolean {
  return /^row-\d+$/.test(id);
}

function displayId(id: string): string {
  const m = id.match(/^row-(\d+)$/);
  if (m) return `(no resource id — line ${m[1]})`;
  // middle truncation: Azure/ARN ids carry the resource NAME at the end —
  // end-truncation makes sibling resources indistinguishable
  if (id.length > 64) return id.slice(0, 26) + '…' + id.slice(-34);
  return id;
}

export default function Dashboard({ session, result, onBack, onReset, onExplore }: Props) {
  const [copied, setCopied] = useState(false);
  const r = result;
  const countOnly = r.costWeightedScore === null;
  const money = makeMoneyContext(r.currencies);
  const divergence =
    r.costWeightedScore !== null && Math.abs(r.costWeightedScore - r.resourceCountScore) >= DIVERGENCE_THRESHOLD_POINTS
      ? { spendHigher: r.costWeightedScore > r.resourceCountScore }
      : null;

  async function copyMarkdown() {
    const md = buildMarkdown(session.fileName, r, money);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable; show the report in a prompt as fallback
      window.prompt('Copy the report:', md);
    }
  }

  return (
    <section className="dashboard">
      <div className="screen-heading">
        <span className="kicker">Report</span>
        <h2>Coverage report</h2>
        <p>
          <strong>{session.fileName}</strong>
          {session.isDemo && <span className="badge badge--demo">demo</span>} ·{' '}
          {r.analyzedResources.toLocaleString()} resources analyzed
        </p>
      </div>

      {/* two independent grades — spend allocation and resource compliance
          answer different questions and are never combined */}
      <div className={'grade-pair' + (countOnly ? ' grade-pair--single' : '')}>
        {!countOnly && r.spendGrade && (
          <div className="score-card" data-grade={r.spendGrade}>
            <h3 className="score-card__title">Spend allocation</h3>
            <div className="score-card__body">
              <div className="score-card__grade">
                <span className="grade-letter">{r.spendGrade}</span>
                <span className="grade-label">{SPEND_GRADE_LABELS[r.spendGrade]}</span>
              </div>
              <div className="score-card__metrics">
                <div className="metric metric--big">
                  <span className="metric-value">{r.costWeightedScore!.toFixed(1)}%</span>
                  <span className="metric-label">of taggable spend is fully allocatable</span>
                </div>
                <div className="metric metric--alert">
                  <span className="metric-value">{money.fmt(r.unallocatedCost)}</span>
                  <span className="metric-label">unallocated (of {money.fmt(r.totalCost)} taggable)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="score-card" data-grade={r.resourceGrade}>
          <h3 className="score-card__title">Resource compliance</h3>
          <div className="score-card__body">
            <div className="score-card__grade">
              <span className="grade-letter">{r.resourceGrade}</span>
              <span className="grade-label">{RESOURCE_GRADE_LABELS[r.resourceGrade]}</span>
            </div>
            <div className="score-card__metrics">
              <div className="metric metric--big">
                <span className="metric-value">{r.resourceCountScore.toFixed(1)}%</span>
                <span className="metric-label">
                  {r.compliantResourceCount.toLocaleString()} of {r.analyzedResources.toLocaleString()}{' '}
                  resources satisfy the complete tag policy
                </span>
              </div>
              <div className="metric metric--alert">
                <span className="metric-value">{r.nonCompliantResourceCount.toLocaleString()}</span>
                <span className="metric-label">non-compliant resources</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {divergence && (
        <p className="divergence" role="note">
          <strong>Coverage divergence:</strong>{' '}
          {divergence.spendHigher ? (
            <>
              {r.costWeightedScore!.toFixed(1)}% of spend is allocatable, but only{' '}
              {r.resourceCountScore.toFixed(1)}% of resources comply. A small number of costly compliant
              resources may be masking broader tagging gaps.
            </>
          ) : (
            <>
              {r.resourceCountScore.toFixed(1)}% of resources comply, but only{' '}
              {r.costWeightedScore!.toFixed(1)}% of spend is allocatable. A smaller number of costly
              non-compliant resources is driving the allocation gap.
            </>
          )}
        </p>
      )}

      {/* data quality notes */}
      <DataQualityNotes r={r} skipped={session.skippedRows ?? 0} money={money} />

      {/* spend composition */}
      {!countOnly && <SpendComposition r={r} money={money} />}

      <div className="dashboard-grid">
        {/* per-tag coverage */}
        <div className="card">
          <h3>Coverage per mandatory tag</h3>
          {!countOnly && (
            <div className="bar-legend">
              <span className="bar-legend__item">
                <span className="bar-legend__swatch bar-legend__swatch--spend" />
                Spend coverage
              </span>
              <span className="bar-legend__item">
                <span className="bar-legend__swatch bar-legend__swatch--resources" />
                Resource coverage
              </span>
            </div>
          )}
          {r.perTag.map((t) => (
            <div key={t.key} className="tagbar">
              <div className="tagbar__head">
                <span>{t.label}</span>
                <span className="tagbar__stats">
                  {t.costPct !== null && <>{t.costPct.toFixed(1)}% of spend · </>}
                  {t.resourcePct.toFixed(1)}% of resources · {t.missingCount} missing
                </span>
              </div>
              <div className="tagbar__track">
                {t.costPct !== null && (
                  <div className="tagbar__fill" style={{ width: `${Math.max(2, t.costPct)}%` }} />
                )}
                <div
                  className="tagbar__fill tagbar__fill--resources"
                  style={{ width: `${Math.max(2, t.resourcePct)}%` }}
                />
              </div>
              {(t.soloRecoverableCost ?? 0) >= 1 && (
                <div className="tagbar__insight">
                  Fixing {t.label} alone recovers <strong>{money.fmt(t.soloRecoverableCost!)}</strong> of
                  allocation
                </div>
              )}
            </div>
          ))}
          <p className="hint">
            {countOnly
              ? 'Resource coverage — share of resources carrying each tag.'
              : 'Both views shown: share of spend and share of resources carrying each tag.'}
          </p>
          {r.placeholders.length > 0 && (
            <p className="placeholder-note">
              <strong>Placeholder tag values treated as missing:</strong>{' '}
              {r.placeholders.map((p) => `"${p.value}" (${p.occurrences})`).join(', ')} —{' '}
              {r.placeholderOccurrenceCount.toLocaleString()} tag-value{' '}
              {r.placeholderOccurrenceCount === 1 ? 'occurrence' : 'occurrences'} across{' '}
              {r.placeholderResourceCount.toLocaleString()}{' '}
              {r.placeholderResourceCount === 1 ? 'resource' : 'resources'}. These never count as coverage.
            </p>
          )}
        </div>

        {/* drift findings */}
        <div className="card">
          <h3>
            Tag drift <span className="badge">{r.drift.length}</span>
          </h3>
          {r.drift.length === 0 ? (
            <p className="empty-hint">No drift detected — tag keys and values look consistent. Rare and admirable.</p>
          ) : (
            <ul className="drift-list">
              {r.drift.map((d, i) => (
                <li key={i}>
                  <span className={'badge badge--' + d.type}>{d.type}</span> {d.suggestion}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* by service */}
      <div className="card">
        <h3>Where the unallocated spend lives</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th className="num">Total cost</th>
                <th className="num cellbar-col">Unallocated</th>
                <th className="num">Resources</th>
                <th className="num">Non-compliant</th>
              </tr>
            </thead>
            <tbody>
              {r.byService.slice(0, 10).map((s) => {
                const max = r.byService[0]?.unallocatedCost || 1;
                const pct = Math.max(1.5, (s.unallocatedCost / max) * 100);
                return (
                  <tr key={s.service}>
                    <td>{s.service}</td>
                    <td className="num">{money.fmt(s.totalCost)}</td>
                    <td className="num warn cellbar">
                      <span className="cellbar__fill" style={{ width: `${pct}%` }} aria-hidden="true" />
                      <span className="cellbar__val">{money.fmt(s.unallocatedCost)}</span>
                    </td>
                    <td className="num">{s.resourceCount}</td>
                    <td className="num">{s.nonCompliantCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* offenders */}
      <div className="card">
        <h3>Fix these first — highest-cost non-compliant resources</h3>
        {r.offenders.length === 0 ? (
          <p className="empty-hint">
            Nothing to fix — every analyzed resource carries all mandatory tags. Grade A earned.
          </p>
        ) : (
          <OffendersTable r={r} money={money} />
        )}
      </div>

      {/* one row on mobile (≤640px) via .actions--toolbar; desktop unchanged.
          Labels swap by CSS; aria-labels always carry the full meaning. */}
      <div className="actions actions--sticky actions--toolbar">
        <button className="btn btn--ghost" onClick={onBack} aria-label="Adjust column mapping">
          <span className="label-full">← Adjust mapping</span>
          <span className="label-short" aria-hidden="true">
            Mapping
          </span>
        </button>
        <button className="btn btn--ghost" onClick={onReset} aria-label="Analyze a new file">
          <span className="label-full">New file</span>
          <span className="label-short" aria-hidden="true">
            New
          </span>
        </button>
        <button
          className="btn"
          onClick={onExplore}
          aria-label={`View all ${r.analyzedResources.toLocaleString()} resources`}
        >
          <span className="label-full">View all resources ({r.analyzedResources.toLocaleString()})</span>
          <span className="label-short" aria-hidden="true">
            Resources
          </span>
        </button>
        <button className="btn btn--primary" onClick={copyMarkdown} aria-label="Copy Markdown report">
          <span className="label-full">{copied ? 'Copied ✓' : 'Copy Markdown report'}</span>
          <span className="label-short" aria-hidden="true">
            {copied ? 'Copied ✓' : 'Copy'}
          </span>
        </button>
      </div>
    </section>
  );
}

function OffendersTable({ r, money }: { r: AnalysisResult; money: MoneyContext }) {
  // rank by cost, but don't pretend $0.00 rows are a priority list:
  // negligible-cost offenders collapse into a single summary row
  const material = r.offenders.filter((o) => (o.cost ?? 0) >= NEGLIGIBLE);
  const negligible = r.offenders.length - material.length;
  const shown = material.slice(0, 20);
  const hasMaterial = shown.length > 0;
  return (
    <div className="table-scroll">
      {!hasMaterial && (
        <p className="empty-hint">
          All {r.offenders.length} non-compliant resources have negligible cost (under{' '}
          {money.fmt(NEGLIGIBLE)} each). Nothing here moves the allocation needle — but untagged resources
          still hide ownership.
        </p>
      )}
      {hasMaterial && (
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Service</th>
              <th className="num">Cost</th>
              <th>Missing tags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id}>
                <td
                  className={'mono mono--truncate' + (isSyntheticId(o.id) ? ' hint' : '')}
                  title={displayId(o.id)}
                >
                  {displayId(o.id)}
                </td>
                <td>{o.service ?? '—'}</td>
                <td className="num">{o.cost !== undefined ? money.fmt(o.cost) : '—'}</td>
                <td>
                  {r.perTag
                    .filter((t) => isNullToken(o.tags[t.key], DEFAULT_POLICY))
                    .map((t) => (
                      <span key={t.key} className="badge badge--missing">
                        {t.label}
                      </span>
                    ))}
                </td>
              </tr>
            ))}
            {negligible > 0 && (
              <tr>
                <td colSpan={4} className="hint">
                  + {negligible} more non-compliant {negligible === 1 ? 'resource' : 'resources'} with
                  negligible cost (under {money.fmt(NEGLIGIBLE)} each)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SpendComposition({ r, money }: { r: AnalysisResult; money: MoneyContext }) {
  const allocated = Math.max(0, r.totalCost - r.unallocatedCost);
  const untaggable = Math.max(0, r.untaggableCost);
  const total = allocated + r.unallocatedCost + untaggable;
  if (total <= 0) return null;
  const pct = (v: number) => `${(v / total) * 100}%`;
  const segments = [
    { key: 'ok', label: 'Allocatable', value: allocated, cls: 'spendbar__seg--ok' },
    { key: 'bad', label: 'Unallocated', value: r.unallocatedCost, cls: 'spendbar__seg--bad' },
    { key: 'faint', label: 'Untaggable (tax, credits, fees)', value: untaggable, cls: 'spendbar__seg--faint' },
  ].filter((s) => s.value > 0);
  return (
    <div className="card spend-card">
      <h3>Spend composition</h3>
      <div
        className="spendbar"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${money.fmt(s.value)}`).join(', ')}
      >
        {segments.map((s) => (
          <div key={s.key} className={`spendbar__seg ${s.cls}`} style={{ width: pct(s.value) }} />
        ))}
      </div>
      <div className="spendbar-legend">
        {segments.map((s) => (
          <span key={s.key} className="spendbar-legend__item">
            <span className={`spendbar-legend__swatch ${s.cls}`} />
            {s.label} <strong>{money.fmt(s.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function DataQualityNotes({ r, skipped, money }: { r: AnalysisResult; skipped: number; money: MoneyContext }) {
  const notes: string[] = [];
  if (money.currency === null && r.costWeightedScore !== null)
    notes.push('Currency was not provided; amounts are shown without a currency symbol.');
  if (r.untaggableCount > 0)
    notes.push(
      `${r.untaggableCount.toLocaleString()} untaggable ${
        r.untaggableCount === 1 ? 'charge' : 'charges'
      } (${money.fmt(Math.abs(r.untaggableCost))} — tax, credits, fees, RI/SP purchases) excluded from scoring. These cannot carry tags.`,
    );
  if (r.creditCount > 0)
    notes.push(
      `${r.creditCount.toLocaleString()} account-level credit/refund ${
        r.creditCount === 1 ? 'row' : 'rows'
      } (${money.fmt(Math.abs(r.creditTotal))}) excluded from coverage math.`,
    );
  if (r.nettedCreditCount > 0)
    notes.push(
      `${r.nettedCreditCount.toLocaleString()} negative line ${
        r.nettedCreditCount === 1 ? 'item' : 'items'
      } netted into resource costs (discounts belong to their resources).`,
    );
  if (r.negativeResourceCount > 0)
    notes.push(
      `${r.negativeResourceCount.toLocaleString()} ${
        r.negativeResourceCount === 1 ? 'resource' : 'resources'
      } netted below zero — clamped to ${money.fmt(0)} for scoring.`,
    );
  if (r.duplicateIdCount > 0)
    notes.push(
      `${r.duplicateIdCount.toLocaleString()} line items merged — costs summed per resource (billing exports list resources once per day/meter).`,
    );
  if (r.costMissingCount > 0) notes.push(`${r.costMissingCount} rows had unparseable costs (treated as $0).`);
  if (skipped > 0) notes.push(`${skipped} malformed rows skipped.`);
  if (notes.length === 0) return null;
  return (
    <ul className="notes notes--quality">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}

function buildMarkdown(fileName: string, r: AnalysisResult, money: MoneyContext): string {
  const lines: string[] = [];
  lines.push(`# Allocation readiness report — ${fileName}`);
  lines.push('');
  if (r.spendGrade && r.costWeightedScore !== null) {
    lines.push(
      `**Spend allocation: ${r.spendGrade}** (${SPEND_GRADE_LABELS[r.spendGrade]}) — ${r.costWeightedScore.toFixed(
        1,
      )}% of taggable spend is fully allocatable`,
    );
    lines.push(`- Unallocated spend: **${money.fmt(r.unallocatedCost)}** of ${money.fmt(r.totalCost)} taggable`);
  }
  lines.push(
    `**Resource compliance: ${r.resourceGrade}** (${RESOURCE_GRADE_LABELS[r.resourceGrade]}) — ${r.resourceCountScore.toFixed(
      1,
    )}% of resources satisfy the complete tag policy`,
  );
  lines.push(
    `- ${r.compliantResourceCount} of ${r.analyzedResources} resources compliant · ${r.nonCompliantResourceCount} non-compliant`,
  );
  if (money.currency === null && r.costWeightedScore !== null)
    lines.push('- Currency was not provided; amounts are shown without a currency symbol.');
  lines.push('');
  lines.push('_Spend allocation and resource compliance are graded independently — they answer different questions and are never combined into an overall grade._');
  if (
    r.costWeightedScore !== null &&
    Math.abs(r.costWeightedScore - r.resourceCountScore) >= DIVERGENCE_THRESHOLD_POINTS
  ) {
    lines.push('');
    lines.push(
      r.costWeightedScore > r.resourceCountScore
        ? `> **Coverage divergence:** ${r.costWeightedScore.toFixed(1)}% of spend is allocatable, but only ${r.resourceCountScore.toFixed(1)}% of resources comply. A small number of costly compliant resources may be masking broader tagging gaps.`
        : `> **Coverage divergence:** ${r.resourceCountScore.toFixed(1)}% of resources comply, but only ${r.costWeightedScore.toFixed(1)}% of spend is allocatable. A smaller number of costly non-compliant resources is driving the allocation gap.`,
    );
  }
  if (r.placeholders.length > 0) {
    lines.push('');
    lines.push(
      `**Placeholder tag values treated as missing:** ${r.placeholders
        .map((p) => `\`${p.value}\` (${p.occurrences})`)
        .join(', ')} — tag-value occurrences in tracked dimensions; these never count as coverage.`,
    );
  }
  lines.push('');
  lines.push('## Coverage per mandatory tag');
  lines.push('');
  lines.push('| Tag | Spend coverage | Resource coverage | Missing |');
  lines.push('|---|---|---|---|');
  for (const t of r.perTag)
    lines.push(
      `| ${t.label} | ${t.costPct === null ? '—' : t.costPct.toFixed(1) + '%'} | ${t.resourcePct.toFixed(1)}% | ${t.missingCount} |`,
    );
  if (r.drift.length > 0) {
    lines.push('');
    lines.push('## Drift findings');
    lines.push('');
    for (const d of r.drift) lines.push(`- (${d.type}) ${d.suggestion}`);
  }
  if (r.offenders.length > 0) {
    lines.push('');
    lines.push('## Fix first (top non-compliant by cost)');
    lines.push('');
    lines.push('| Resource | Service | Cost |');
    lines.push('|---|---|---|');
    for (const o of r.offenders.slice(0, 10))
      lines.push(`| ${o.id} | ${o.service ?? '—'} | ${o.cost !== undefined ? money.fmt(o.cost) : '—'} |`);
  }
  lines.push('');
  lines.push(
    '_Generated with Untagged — client-side cloud cost allocation readiness auditor. Method informed by the FinOps Foundation untagged-cost KPI playbook and extended for mandatory-tag policy compliance; grades are Untagged conventions._',
  );
  return lines.join('\n');
}
