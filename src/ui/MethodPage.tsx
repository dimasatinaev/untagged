import { DIVERGENCE_THRESHOLD_POINTS } from '../engine/policy.ts';

interface Props {
  onBack: () => void;
}

/**
 * The methodology page. Looks like documentation; works like the deepest
 * marketing asset — it's the proof of domain judgment practitioners link to.
 */
export default function MethodPage({ onBack }: Props) {
  return (
    <section className="method">
      <div className="screen-heading">
        <span className="kicker">Method</span>
        <h2>How the scoring works</h2>
        <p>
          Method informed by the{' '}
          <a
            href="https://www.finops.org/wg/percentage-of-costs-associated-with-untagged-csp-cloud-resources/"
            target="_blank"
            rel="noreferrer"
          >
            FinOps Foundation untagged-cost KPI playbook
          </a>{' '}
          and extended for mandatory-tag policy compliance — every judgment call documented below.{' '}
          <a href="https://github.com/dimasatinaev/untagged" target="_blank" rel="noreferrer">
            View source
          </a>
        </p>
      </div>

      <div className="method-body">
        <h3>Two grades, never combined</h3>
        <p>
          Untagged reports <em>two independent grades</em>, because spend allocation and resource compliance
          answer different questions and neither substitutes for the other:
        </p>
        <p>
          <strong>Spend allocation</strong> answers "how much spend is allocatable?" — the percentage of
          taggable spend on resources that carry a real value for every enabled mandatory tag.{' '}
          <strong>Resource compliance</strong> answers "how much of the resource inventory follows the
          selected policy?" — the percentage of analyzed resources meeting the same bar.
        </p>
        <p>
          They are graded separately using the same thresholds (A ≥95%, B ≥85%, C ≥70%, D ≥50%, F below
          50%). There is deliberately no average, no minimum, no capping of one by the other, and no
          composite "overall" grade: a single figure can hide the truth in either direction. Both
          measurements are stricter than the FinOps Foundation's base untagged-cost KPI, which counts
          resources missing at least one tag — Untagged evaluates compliance with the complete enabled
          policy. The A–F bands are Untagged conventions for readability, not official FinOps Foundation
          grades. The four built-in dimensions (owner, team, environment, cost center) are common examples,
          not an industry standard — each can be remapped to any CSV column or disabled on the mapping
          screen; user-defined policy dimensions are not yet supported.
        </p>

        <h3>Why the two can diverge</h3>
        <p>
          Cloud spend is usually concentrated: a handful of resources can carry most of the bill. If those
          few are tagged, spend allocation looks excellent while most of the inventory is still unowned —
          and the reverse happens when a small number of expensive resources are untagged. When the two
          scores differ by at least {DIVERGENCE_THRESHOLD_POINTS} percentage points, the report says so
          explicitly and names the direction. That threshold is an Untagged presentation convention, not a
          Foundation standard.
        </p>

        <h3>"n/a" is not a tag</h3>
        <p>
          A tag counts as missing when its value is empty or a null token: <code>n/a</code>, <code>na</code>,{' '}
          <code>none</code>, <code>null</code>, <code>-</code>, <code>unknown</code>, <code>tbd</code> and
          similar (case and surrounding whitespace are ignored). People fill mandatory fields with
          placeholders to get past forms — and IaC modules do it by default — so counting those as "tagged"
          would flatter the score without making the spend allocatable. The report lists which placeholder
          values it found and how often, so the practice is visible rather than silently absorbed. A
          resource keeps a real value found on any of its line items; a placeholder never overwrites one.
        </p>

        <h3>Line items are aggregated into resources</h3>
        <p>
          Billing exports list each resource many times — once per day, per meter, per charge type. Costs are
          summed per resource id (case-insensitively — Azure ids vary in casing between line items), and a
          tag counts as present if <em>any</em> line item carries a real value for it. A resource's service
          label is its dominant-cost category, so a VM whose line items span compute, bandwidth, and disk
          charges is labeled a VM, not "Bandwidth."
        </p>

        <h3>Untaggable charges are excluded — not "fixable"</h3>
        <p>
          Taxes, account-level credits and refunds, support fees, and RI/Savings Plan purchases cannot carry
          resource tags. When a charge-type column is present (<code>lineItem/LineItemType</code>, Azure{' '}
          <code>ChargeType</code>, FOCUS <code>ChargeCategory</code>), these rows are reported as their own
          bucket and removed from scoring. The score then means: <em>of the spend that could be tagged, how
          much is allocatable</em>. This adaptation follows the playbook's own alternative formula for
          comparing untagged costs against total <em>taggable</em> costs — and it is why 100% is rarely
          achievable and the playbook's initial target is &lt;10% untagged.
        </p>

        <h3>Currency handling</h3>
        <p>
          When a currency column is mapped, all amounts are formatted in that currency. If a file mixes
          multiple currencies, Untagged refuses to produce a score — amounts in different currencies cannot
          be meaningfully summed, and a wrong total is worse than no total. Export a single-currency file
          instead. When no currency column exists, amounts are shown as plain numbers without a symbol, with
          a note on the report.
        </p>

        <h3>Negative line items are netted</h3>
        <p>
          A discount or refund attached to a resource belongs to that resource, so negative line items are
          netted into their resource's cost — allocation practice works on net spend. Unattached negatives
          (account-level credits with no resource id) are excluded and reported separately. A resource that
          nets below zero is clamped to $0 for scoring, with a note.
        </p>

        <h3>Drift detection is deliberately conservative</h3>
        <p>
          <code>env</code> vs <code>Environment</code> columns, <code>prod</code> vs <code>production</code>{' '}
          values, case variants, and same-words-different-order names are flagged because group-by reports
          silently split them. Sequential codes like <code>CC-1042</code> / <code>CC-1043</code> are{' '}
          <em>not</em> flagged — identical non-digit skeletons mean distinct identifiers, not typos. Findings
          are suggestions; nothing is ever merged automatically.
        </p>

        <h3>Solo-recoverable spend</h3>
        <p>
          For each mandatory tag, the report shows how much unallocated spend sits on resources where that
          tag is the <em>only</em> one missing — the cheapest possible wins. "Fixing Environment alone
          recovers $28,001" is a sentence you can put in a slide.
        </p>

        <h3>Privacy, verifiably</h3>
        <p>
          Analysis runs entirely in your browser. File analysis makes no outbound network requests: the
          application cannot transmit your CSV because its Content-Security-Policy enforces{' '}
          <code>connect-src 'none'</code> — open DevTools → Network while you analyze a file and watch
          nothing happen. (Hosting-level headers from the CDN, such as network-error logging, exist on any
          site and never contain your data.) The source is public, so the claim is auditable, not just
          asserted.
        </p>

        <h3>Limitations, honestly</h3>
        <p>
          Results are estimates: they reflect the file you provide, for the period it covers. Mixed-currency
          files are refused rather than converted. Tested formats: FOCUS 1.0 and 1.0-preview exports, Azure
          Cost Management EA exports (Actual and Amortized), legacy AWS CUR (raw and Athena-style headers),
          and AWS Cost Explorer-style CSVs — other formats work through manual mapping but are not
          regression-tested. The resource explorer retains the top 5,000 resources by cost (disclosed on
          screen when truncated). Coverage measured on a simplified export can differ slightly from full
          CUR-level analysis. Verify figures before using them in financial reporting.
        </p>
      </div>

      <div className="actions">
        <button className="btn btn--ghost" onClick={onBack}>
          ← Back
        </button>
      </div>
    </section>
  );
}
