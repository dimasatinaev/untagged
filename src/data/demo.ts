/**
 * Demo dataset: "Nimbus Retail Group" — a fictional company.
 * ~200 multi-cloud rows engineered so every product feature is visible:
 * - ~25% of spend missing at least one mandatory tag
 * - key drift: both "env" and "Environment" columns exist
 * - value drift: prod/production/PROD, payments-team vs team-payments
 * - null tokens: "n/a", "-", "none"
 * - credits (negative cost), zero-cost rows, one duplicate resource id
 *
 * Generated deterministically (seeded PRNG) and serialized as CSV so it flows
 * through the exact same parse -> detect -> analyze path as a real file.
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEAMS = ['payments', 'search', 'data-platform'];
export const OWNERS: Record<string, string[]> = {
  payments: ['anna.k', 'marek.v', 'lucie.h'],
  search: ['tomas.b', 'eva.s'],
  'data-platform': ['petr.n', 'jana.d', 'ondrej.m'],
};
export const COST_CENTERS: Record<string, string> = {
  payments: 'CC-1042',
  search: 'CC-1043',
  'data-platform': 'CC-2077',
};

interface Svc {
  name: string;
  provider: string;
  regions: string[];
  prefix: string;
  costRange: [number, number];
}

const SERVICES: Svc[] = [
  { name: 'EC2', provider: 'aws', regions: ['eu-central-1', 'us-east-1'], prefix: 'i-0', costRange: [40, 900] },
  { name: 'RDS', provider: 'aws', regions: ['eu-central-1'], prefix: 'db-', costRange: [120, 1400] },
  { name: 'S3', provider: 'aws', regions: ['eu-central-1', 'us-east-1'], prefix: 'bucket-', costRange: [5, 220] },
  { name: 'Lambda', provider: 'aws', regions: ['eu-central-1'], prefix: 'fn-', costRange: [0, 60] },
  { name: 'Virtual Machines', provider: 'azure', regions: ['westeurope'], prefix: 'vm-', costRange: [60, 800] },
  { name: 'Azure SQL', provider: 'azure', regions: ['westeurope'], prefix: 'sqldb-', costRange: [150, 1200] },
  { name: 'Compute Engine', provider: 'gcp', regions: ['europe-west1'], prefix: 'gce-', costRange: [50, 700] },
  { name: 'BigQuery', provider: 'gcp', regions: ['europe-west1'], prefix: 'bq-', costRange: [20, 1600] },
];

const ENV_VALUES_CLEAN = ['prod', 'staging', 'dev'];

export function generateDemoCsv(rowCount = 200): string {
  const rnd = mulberry32(20260706);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const between = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;

  const headers = [
    'resource_id',
    'service',
    'cloud_provider',
    'region',
    'monthly_cost',
    'owner',
    'team',
    'env',
    'Environment',
    'cost_center',
  ];
  const lines = [headers.join(',')];

  const rows: string[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const svc = pick(SERVICES);
    const team = pick(TEAMS);
    const id = `${svc.prefix}${(100000 + Math.floor(rnd() * 899999)).toString(16)}`;
    let cost = between(svc.costRange[0], svc.costRange[1]);

    let owner: string = pick(OWNERS[team]);
    let teamValue: string = team;
    let envA = pick(ENV_VALUES_CLEAN); // "env" column
    let envB = ''; // "Environment" column (key-drift demo: mostly empty)
    let costCenter: string = COST_CENTERS[team];

    const roll = rnd();
    if (roll < 0.08) {
      owner = ''; // simply missing
    } else if (roll < 0.13) {
      owner = pick(['n/a', '-', 'none']); // null tokens
    }
    if (rnd() < 0.1) teamValue = '';
    if (rnd() < 0.06) teamValue = teamValue === 'payments' ? 'team-payments' : teamValue; // token-order drift
    if (rnd() < 0.18) costCenter = '';

    // value drift on env
    const envRoll = rnd();
    if (envA === 'prod' && envRoll < 0.25) envA = pick(['production', 'PROD', 'Prod']);
    // key drift: ~10% of rows use the "Environment" column instead of "env"
    if (rnd() < 0.1) {
      envB = envA;
      envA = '';
    }
    // some rows have no environment at all
    if (rnd() < 0.07) {
      envA = '';
      envB = '';
    }

    // zero-cost rows (Lambda free tier etc.)
    if (svc.name === 'Lambda' && rnd() < 0.5) cost = 0;

    rows.push([
      id,
      svc.name,
      svc.provider,
      pick(svc.regions),
      String(cost),
      owner,
      teamValue,
      envA,
      envB,
      costCenter,
    ]);
  }

  // engineered extras:
  // one fat fully-untagged offender (top of the fix list)
  rows.push(['i-0deadbeef', 'EC2', 'aws', 'us-east-1', '2450.00', '', '', '', '', '']);
  // an account-level credit line (no resource id — stays unattached)
  rows.push(['', 'EC2', 'aws', 'us-east-1', '-1200.00', '', '', '', '', '']);
  // duplicate resource id (dedup demo)
  rows.push(['db-shared-01', 'RDS', 'aws', 'eu-central-1', '410.00', 'anna.k', 'payments', 'prod', '', 'CC-1042']);
  rows.push(['db-shared-01', 'RDS', 'aws', 'eu-central-1', '395.00', 'anna.k', 'payments', 'prod', '', 'CC-1042']);

  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n');
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export const DEMO_COMPANY = 'Nimbus Retail Group (fictional demo data)';
