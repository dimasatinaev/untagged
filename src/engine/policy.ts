import type { TagPolicy, Grade } from './types.ts';

/**
 * Default tag policy. Synonyms are matched against normalized column headers
 * (lowercased, separators stripped) — see detect.ts.
 *
 * Null tokens are deliberately conservative: values like "test" or "temp" are
 * legitimate in some columns (environment=test), so they are NOT null tokens.
 */
export const DEFAULT_POLICY: TagPolicy = {
  mandatoryTags: [
    {
      key: 'owner',
      label: 'Owner',
      synonyms: ['owner', 'ownedby', 'owneremail', 'contact', 'responsible', 'creator'],
    },
    {
      key: 'team',
      label: 'Team',
      synonyms: [
        'team',
        'squad',
        'teamname',
        'group',
        'owningteam',
        'department',
        'dept',
        'businessunit',
        'bu',
        'orgunit',
      ],
    },
    {
      key: 'environment',
      label: 'Environment',
      synonyms: ['environment', 'env', 'stage', 'envname'],
    },
    {
      key: 'cost_center',
      label: 'Cost center',
      synonyms: ['costcenter', 'costcentre', 'cc', 'billingcode', 'costcode'],
    },
  ],
  nullTokens: [
    '',
    'n/a',
    'na',
    'none',
    'null',
    'nil',
    'unknown',
    'undefined',
    'tbd',
    'todo',
    '?',
    '-',
    '--',
    'not set',
    'notset',
    'unset',
    'missing',
    'empty',
    'no value',
    'novalue',
    'nobody',
    'no owner',
  ],
};

/** trim + lowercase; the form null tokens are compared against */
export function normalizeValue(v: string | undefined | null): string {
  return (v ?? '').trim().toLowerCase();
}

export function isNullToken(value: string | undefined | null, policy: TagPolicy): boolean {
  return policy.nullTokens.includes(normalizeValue(value));
}

export function gradeForScore(score: number): Grade {
  if (score >= 95) return 'A';
  if (score >= 85) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export const GRADE_LABELS: Record<Grade, string> = {
  A: 'Allocation-ready',
  B: 'Minor gaps',
  C: 'Material unallocated spend',
  D: 'Allocation at risk',
  F: 'Flying blind',
};
