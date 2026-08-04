/** Core domain types for the Untagged analysis engine. Dependency-free. */

export interface MandatoryTag {
  /** canonical key, e.g. "environment" */
  key: string;
  /** human label, e.g. "Environment" */
  label: string;
  /** lowercase synonyms used to match CSV columns / tag keys */
  synonyms: string[];
}

export interface TagPolicy {
  mandatoryTags: MandatoryTag[];
  /** normalized (trimmed, lowercased) values treated as "no value" */
  nullTokens: string[];
}

export interface ColumnMapping {
  resourceId?: string;
  service?: string;
  provider?: string;
  region?: string;
  cost?: string;
  currency?: string;
  /** charge/line-item type column (lineItem/LineItemType, ChargeType,
   * ChargeCategory) — used to exclude untaggable charges (tax, credits, fees) */
  chargeType?: string;
  /** canonical mandatory tag key -> source CSV column header */
  tagColumns: Record<string, string>;
  /** column whose cell values are a JSON object of tags (FOCUS "Tags", CUR 2.0 "resource_tags") */
  jsonTagColumn?: string;
  /** canonical mandatory tag key -> key inside the JSON tag object */
  jsonTagKeys?: Record<string, string>;
}

export type PresetId = 'aws-cur' | 'aws-cost-explorer' | 'azure-cost-mgmt' | 'focus' | 'generic';

export interface DetectionResult {
  preset: PresetId;
  mapping: ColumnMapping;
  /** 0..1 — how many core roles were confidently matched */
  confidence: number;
  notes: string[];
  /** all tag keys discovered inside the JSON tag column (for the mapping UI) */
  jsonKeys?: string[];
}

export interface ParseResult {
  headers: string[];
  /** row-major values, same length as headers */
  rows: string[][];
  delimiter: string;
  /** indices (1-based, excluding header) of rows skipped due to malformed column counts */
  skippedRows: number[];
}

export interface Resource {
  id: string;
  service?: string;
  provider?: string;
  region?: string;
  /** SUM of this resource's line-item costs; undefined when no cost column */
  cost?: number;
  /** canonical mandatory tag key -> raw value from CSV (may be a null-token) */
  tags: Record<string, string>;
  /** number of billing line items aggregated into this resource */
  lineItems?: number;
}

export interface TagCoverage {
  key: string;
  label: string;
  /** % of resources with a real (non-null-token) value, 0..100 */
  resourcePct: number;
  /** % of cost carried by resources with a real value, 0..100; null when no cost data */
  costPct: number | null;
  missingCount: number;
  /** of the missing ones, how many hold a placeholder value rather than nothing */
  placeholderCount: number;
  /** spend recovered by fixing ONLY this tag (resources where it is the single
   * missing mandatory tag); null when no cost data */
  soloRecoverableCost: number | null;
}

export interface DriftFinding {
  type: 'key' | 'value';
  /** for key drift: the raw column headers involved; for value drift: raw values */
  members: string[];
  /** canonical tag this drift relates to, when known */
  tagKey?: string;
  suggestion: string;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface PlaceholderFinding {
  /** normalized placeholder text as found, e.g. "n/a" */
  value: string;
  /** number of (resource, mandatory tag) pairs holding this placeholder */
  occurrences: number;
  /** number of distinct resources affected */
  resources: number;
}

export interface AnalysisResult {
  totalResources: number;
  /** resources considered in coverage math (after credit/dedup exclusions) */
  analyzedResources: number;
  /** % of taggable spend on resources satisfying EVERY enabled mandatory tag;
   * null when no usable cost data */
  costWeightedScore: number | null;
  /** % of analyzed resources satisfying EVERY enabled mandatory tag */
  resourceCountScore: number;
  /** graded from costWeightedScore; null when there is no usable cost data.
   * Independent of resourceGrade — never averaged, capped, or combined. */
  spendGrade: Grade | null;
  /** graded from resourceCountScore. Independent of spendGrade. */
  resourceGrade: Grade;
  /** resources satisfying every enabled mandatory tag */
  compliantResourceCount: number;
  /** resources missing at least one enabled mandatory tag */
  nonCompliantResourceCount: number;
  /** placeholder values ("n/a", "unknown", …) found in enabled policy
   * dimensions and treated as missing; genuinely empty cells excluded */
  placeholders: PlaceholderFinding[];
  /** total (resource, tag) pairs holding a placeholder */
  placeholderOccurrenceCount: number;
  /** exact union of distinct resources holding at least one placeholder —
   * not the max across placeholder values */
  placeholderResourceCount: number;
  perTag: TagCoverage[];
  totalCost: number;
  unallocatedCost: number;
  /** unattached negative line items (account-level credits/refunds), excluded */
  creditCount: number;
  creditTotal: number;
  /** negative line items netted into their resource's cost */
  nettedCreditCount: number;
  /** resources whose netted cost was negative (clamped to 0 for scoring) */
  negativeResourceCount: number;
  /** line items excluded as untaggable by charge type (tax, credits, fees, purchases) */
  untaggableCount: number;
  untaggableCost: number;
  /** rows whose cost failed to parse (treated as 0, still counted) */
  costMissingCount: number;
  duplicateIdCount: number;
  drift: DriftFinding[];
  /** non-compliant resources sorted by cost desc */
  offenders: Resource[];
  byService: ServiceBreakdown[];
  /** all aggregated resources sorted by cost desc (capped — see resourcesTruncated) */
  resources: Resource[];
  resourcesTruncated: boolean;
  /** distinct normalized currency codes seen across the full pass.
   * length > 1 means the file mixes currencies — the UI must refuse to show
   * summed monetary figures in that case */
  currencies: string[];
}

export interface ServiceBreakdown {
  service: string;
  totalCost: number;
  unallocatedCost: number;
  resourceCount: number;
  nonCompliantCount: number;
}
