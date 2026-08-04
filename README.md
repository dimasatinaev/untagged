# Untagged

**Cloud cost allocation readiness auditor. Your CSV never leaves the browser.**

Find the cloud spend missing required allocation tags. Drop in a cost export and get:

- **Two independent grades** — *spend allocation* (% of taggable spend fully allocatable) and *resource compliance* (% of resources satisfying the complete tag policy). They answer different questions and are never averaged, capped, or merged into an overall grade; when they diverge by 15+ points the report says why
- A **placeholder-value summary** — `n/a`, `unknown`, `-` and similar are treated as missing and listed explicitly, so dummy IaC defaults are visible rather than silently absorbed
- **Unallocated spend** estimate, per service, with a spend-composition breakdown
- **Per-tag coverage** for your tracked mandatory tags, including solo-recoverable spend per tag
- **Tag drift detection** — `env` vs `Environment` columns, `prod` vs `production` values, token-order and typo variants
- A prioritized **fix-first list**, a filterable resource explorer, CSV export, and a copyable **Markdown report**

Method informed by the [FinOps Foundation untagged-cost KPI playbook](https://www.finops.org/wg/percentage-of-costs-associated-with-untagged-csp-cloud-resources/) and extended for mandatory-tag policy compliance: the tool checks the *complete selected tag policy* (not only fully-untagged resources), values like `n/a`, `none`, `-` count as **missing**, untaggable charges (tax, credits, fees, RI/SP purchases) are excluded per the playbook's taggable-cost alternative formula, and the A–F grades are Untagged conventions, not official FinOps Foundation grades. Default mandatory tags (owner, team, environment, cost center) are common examples, not an industry standard.

## Supported formats (tested)

Regression-tested against fixtures in `samples/` and real exports:

- **FOCUS 1.0 and 1.0-preview** — FinOps Foundation focus_validator sample + Microsoft FOCUS exports (JSON `Tags` column)
- **Azure Cost Management EA** — Actual and Amortized exports (brace-less `Tags` pairs, `ChargeType`, case-varying resource ids)
- **AWS CUR (legacy)** — raw `lineItem/...` and Athena-style `line_item_...` headers, `resourceTags/user:` prefixes
- **AWS Cost Explorer-style** CSVs
- **Generic CSV** — anything else via manual column mapping (fallback, always available)

Other export variants may work but are not verified — file an issue with your header row.

## Currency safety

Amounts are formatted in the file's currency when a currency column is mapped. **Mixed-currency files are refused** — amounts in different currencies cannot be meaningfully summed, so no score is produced; export a single-currency file. Without a currency column, amounts display as plain numbers with a disclosure note.

## Privacy by construction

All parsing and analysis happens client-side. File analysis makes no outbound network requests: the application cannot transmit your CSV because its Content-Security-Policy enforces `connect-src 'none'` (shipped both as an in-page meta tag and as a real HTTP header via `public/_headers`). Verifiable in DevTools → Network; auditable in this repository. Hosting-level headers added by the CDN (e.g. network-error logging) exist on any site and never contain user data; the host also keeps normal request logs, as any host does. No signup, no upload, no client-side analytics, tracking pixels or analytics beacons.

## Fonts (self-hosted)

Fonts are self-hosted to preserve the no-network-requests privacy guarantee — do not load them from the Google Fonts CDN.

- `public/fonts/RubikGlitch-Regular.ttf` (SIL OFL) — brand mark + grade letters only.
- `public/fonts/SpaceGrotesk-{Light,Regular,Medium,SemiBold,Bold}.ttf` (SIL OFL) — the UI typeface, static weights 300–700. Licenses ship alongside as `OFL-*.txt`.

Optional optimization: convert both to woff2 (~70% smaller) and update the `@font-face` rules in `src/styles.css`.

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # engine unit tests (node built-in runner, no deps)
npm run build    # production build (tsc + vite)
```

The analysis engine (`src/engine/`) is dependency-free TypeScript — parsing, detection, scoring, and drift logic are all unit-tested and runnable without installing anything (`npm test` uses Node's built-in test runner).

## Structure

```
src/
  engine/          dependency-free analysis engine
    csv.ts         CSV parser (RFC 4180, delimiter auto-detect, cost parsing)
    detect.ts      column auto-detection + AWS/Azure presets
    policy.ts      tag policy, null tokens, grade bands
    analyze.ts     coverage scoring, credits/dedup handling, breakdowns
    drift.ts       key & value drift detection
    __tests__/     unit tests (node:test)
  data/demo.ts     deterministic demo dataset ("Nimbus Retail Group")
  ui/              React screens: Upload → Mapping → Dashboard
```

## Deploy

Built for Cloudflare Pages (or any static host serving at a root domain — the self-hosted font uses an absolute `/fonts/` path):

- Build command: `npm run build`
- Output directory: `dist`
- Security headers (real HTTP CSP mirroring the in-page meta tag) ship via `public/_headers`, which Cloudflare Pages applies automatically.

The CSP's `connect-src 'none'` is the enforceable form of the privacy promise: the deployed site cannot make network requests after load.

## Status and limitations

**Public beta** — live at https://untagged.pages.dev/

Known limitations: the resource explorer retains the top 5,000 resources by cost (disclosed on screen when truncated); mixed currencies are refused rather than converted; results are estimates — verify before financial reporting. Found a format that doesn't map? Open an issue with your CSV's header row.

## License

Code: [MIT](./LICENSE) © 2026 Dima Satinaev. Methodology and written content: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Provided "as is", without warranty of any kind. Coverage scores and unallocated-spend figures are estimates derived from the data you provide — verify before using them in financial reporting. Not financial advice.
