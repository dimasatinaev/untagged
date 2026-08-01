import { useState } from 'react';
import type { Session } from '../App.tsx';
import type { ColumnMapping } from '../engine/types.ts';
import { DEFAULT_POLICY } from '../engine/policy.ts';
import { presetLabel } from '../engine/detect.ts';
import Combobox, { type ComboGroup } from './Combobox.tsx';

interface Props {
  session: Session;
  onBack: () => void;
  onAnalyze: (mapping: ColumnMapping) => void;
  analyzing: boolean;
  error: string | null;
}

/** the single-column roles a CSV column can be mapped to */
export type RoleKey = 'resourceId' | 'service' | 'provider' | 'region' | 'cost' | 'currency' | 'chargeType';

const ROLES: Array<{ key: RoleKey; label: string; hint?: string }> = [
  { key: 'resourceId', label: 'Resource ID' },
  { key: 'service', label: 'Service' },
  { key: 'provider', label: 'Cloud provider' },
  { key: 'region', label: 'Region' },
  { key: 'cost', label: 'Cost', hint: 'monthly or period cost per row' },
  { key: 'currency', label: 'Currency', hint: 'guards against mixed-currency files' },
  { key: 'chargeType', label: 'Charge type', hint: 'excludes tax/credits/fees from scoring' },
];

const NONE = '__none__';
const JSON_PREFIX = '__json__:';

export default function MappingScreen({ session, onBack, onAnalyze, analyzing, error }: Props) {
  const { sample, detection, fileName, isDemo } = session;
  const [mapping, setMapping] = useState<ColumnMapping>(session.mapping);

  const headers = sample.headers;
  const sampleFull = sample.rows.length >= 500;

  function setRole(key: RoleKey, value: string) {
    setMapping((m) => ({ ...m, [key]: value === NONE ? undefined : value }));
  }
  function setTag(tagKey: string, value: string) {
    setMapping((m) => {
      const tagColumns = { ...m.tagColumns };
      const jsonTagKeys = { ...(m.jsonTagKeys ?? {}) };
      delete tagColumns[tagKey];
      delete jsonTagKeys[tagKey];
      if (value.startsWith(JSON_PREFIX)) jsonTagKeys[tagKey] = value.slice(JSON_PREFIX.length);
      else if (value !== NONE) tagColumns[tagKey] = value;
      return { ...m, tagColumns, jsonTagKeys };
    });
  }

  function tagValue(tagKey: string): string {
    if (mapping.tagColumns[tagKey]) return mapping.tagColumns[tagKey];
    if (mapping.jsonTagKeys?.[tagKey]) return JSON_PREFIX + mapping.jsonTagKeys[tagKey];
    return NONE;
  }

  const mappedTagCount =
    Object.keys(mapping.tagColumns).length + Object.keys(mapping.jsonTagKeys ?? {}).length;
  const canAnalyze = mappedTagCount > 0;
  const jsonKeys = detection.jsonKeys ?? [];
  const jsonColName = mapping.jsonTagColumn ?? session.detection.mapping.jsonTagColumn;

  return (
    <section className="mapping-screen">
      <div className="screen-heading">
        <span className="kicker">Step 2 of 3</span>
        <h2>Check the mapping</h2>
        <p>
          <strong>{fileName}</strong>
          {isDemo && <span className="badge badge--demo">demo</span>} ·{' '}
          {sampleFull ? `sampled first ${sample.rows.length} rows` : `${sample.rows.length.toLocaleString()} rows`} ·
          recognized as {presetLabel(detection.preset)}
        </p>
      </div>

      {detection.notes.length > 0 && (
        <ul className="notes">
          {detection.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <div className="mapping-grid">
        <div className="mapping-card">
          <h3>Columns</h3>
          {ROLES.map((role) => {
            const groups: ComboGroup[] = [
              { options: [{ value: NONE, label: '— none —' }] },
              { label: 'Columns', options: headers.map((h) => ({ value: h, label: h })) },
            ];
            return (
              <div key={role.key} className="mapping-row">
                <span>
                  {role.label}
                  {role.hint && <em className="hint"> — {role.hint}</em>}
                </span>
                <Combobox
                  value={mapping[role.key] ?? NONE}
                  groups={groups}
                  onChange={(v) => setRole(role.key, v)}
                  ariaLabel={role.label}
                  placeholderValues={[NONE]}
                  disabled={analyzing}
                />
              </div>
            );
          })}
        </div>

        <div className="mapping-card">
          <h3>Mandatory tags</h3>
          <p className="hint">Coverage is scored against these. A resource is compliant only when all are present.</p>
          {DEFAULT_POLICY.mandatoryTags.map((tag) => {
            const groups: ComboGroup[] = [
              { options: [{ value: NONE, label: '— not tracked —' }] },
              { label: 'Columns', options: headers.map((h) => ({ value: h, label: h })) },
            ];
            if (jsonKeys.length > 0) {
              groups.push({
                label: `Tag keys inside "${jsonColName}"`,
                options: jsonKeys.map((k) => ({ value: JSON_PREFIX + k, label: `${jsonColName} → ${k}` })),
              });
            }
            return (
              <div key={tag.key} className="mapping-row">
                <span>{tag.label}</span>
                <Combobox
                  value={tagValue(tag.key)}
                  groups={groups}
                  onChange={(v) => setTag(tag.key, v)}
                  ariaLabel={tag.label}
                  placeholderValues={[NONE]}
                  disabled={analyzing}
                />
              </div>
            );
          })}
          {jsonKeys.length > 0 && (
            <p className="hint">
              This file stores tags as JSON inside the "{jsonColName}" column — its keys are listed in the
              dropdowns above and matching ones were pre-selected.
            </p>
          )}
        </div>
      </div>

      <div className="preview-card">
        <h3>Preview (first 8 rows)</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.rows.slice(0, 8).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="actions actions--sticky">
        {error && (
          <p className="error-note error-note--bar" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--ghost" onClick={onBack} disabled={analyzing}>
          ← Start over
        </button>
        <button
          className="btn btn--primary"
          disabled={!canAnalyze || analyzing}
          onClick={() => onAnalyze(mapping)}
          aria-busy={analyzing}
        >
          {analyzing ? 'Analyzing…' : 'Analyze coverage →'}
        </button>
        {!canAnalyze && <span className="hint">Map at least one mandatory tag to analyze.</span>}
        {analyzing && (
          <span className="hint" role="status">
            Running the full streaming pass — large files can take a few seconds.
          </span>
        )}
      </div>
    </section>
  );
}
