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
        <h3>What the headline score is — and is not</h3>
        <p>
          The headline number is Untagged's <em>allocation readiness</em> metric: the percentage of taggable
          spend sitting on resources that carry a real value for <em>every</em> tracked mandatory tag. It is
          stricter than the FinOps Foundation's base untagged-cost KPI, which measures resources missing at
          least one tag — Untagged evaluates compliance with your full selected tag policy. The A–F grade
          bands are Untagged conventions for readability, not official FinOps Foundation grades. The default
          mandatory tags (owner, team, environment, cost center) are common examples, not an industry
          standard — adjust them to your organization's policy on the mapping screen.
        </p>

        <h3>The headline score is cost-weighted</h3>
        <p>
          The score is the percentage of <em>spend</em> sitting on compliant resources — not the percentage
          of resources. Allocation is about money: a 2,450/month untagged instance is a bigger problem than
          forty untagged 0.02 buckets. Both numbers are always shown (engineers fix resources; finance
          allocates spend), but the cost-weighted figure leads.
        </p>

        <h3>"n/a" is not a tag</h3>
        <p>
          A tag counts as missing when its value is empty or a null token: <code>n/a</code>, <code>na</code>,{' '}
          <code>none</code>, <code>null</code>, <code>-</code>, <code>unknown</code>, <code>tbd</code> and
          similar. People fill mandatory fields with placeholders to get past forms; counting those as
          "tagged" would flatter the score without making the spend allocatable.
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
