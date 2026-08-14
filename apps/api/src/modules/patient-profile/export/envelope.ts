/**
 * The envelope every portable export is wrapped in.
 *
 * WHY THERE IS AN ENVELOPE AT ALL. All three target formats are
 * strict: GA4GH Phenopacket is protobuf-with-a-JSON-mapping, and FHIR
 * validators reject unknown fields. So there is nowhere INSIDE a
 * conformant document to put the two things a reader of our data most
 * needs — what we deliberately did not send, and why. Sneaking it in
 * as an extra key would make the document non-conformant; leaving it
 * out would make the document look complete when it is not.
 *
 * The envelope keeps `document` strictly conformant and extractable
 * (a consumer that wants a Phenopacket takes `.document` and nothing
 * else), while `omissions` and `notes` carry the honesty half in a
 * place that cannot corrupt it.
 *
 * `omissions` is the load-bearing field. Every entry is something we
 * HOLD, or that the format has a slot for, and that we chose not to
 * emit — with the reason. An empty `omissions` array would be the
 * claim that nothing was left out, so nothing writes one without
 * meaning it.
 */
export interface ExportOmission {
  /** What was left out, in the receiving format's own vocabulary. */
  readonly field: string;
  readonly reasonZh: string;
}

/**
 * One baseline field in the document that somebody other than the
 * patient entered — contract §B3.
 *
 * It lives on the ENVELOPE for the same reason `omissions` does: all
 * three target formats are strict, and there is no conformant slot in
 * a Phenopacket or a FHIR Bundle for 「this particular answer was typed
 * by our staff, not by the patient」. TREAT-NMD does have one, and
 * annotates its items too — but a receiver that reads only the
 * envelope must still be able to find this, because the alternative is
 * a registry recording our own transcription as patient self-report.
 *
 * `unreadable` is carried rather than dropped: an entry that exists
 * and cannot be parsed is still not the patient's, and falling back to
 * 「no entry」 is exactly how it would be filed as theirs.
 */
export interface ExportFieldOrigin {
  /** Dotted baseline path — the provenance block's own key. */
  readonly path: string;
  readonly labelZh: string;
  readonly state: 'admin_entered' | 'unreadable';
  /** `app_users.id` of the administrator, or null when unreadable. */
  readonly adminUserId: string | null;
  /** ISO 8601, or null when unreadable. */
  readonly at: string | null;
  readonly detail: string | null;
}

export interface PortableExportEnvelope<T> {
  /** Human-readable name of the target format. */
  readonly format: string;
  /**
   * What conformance we actually claim. Never the bare name of a
   * standard: 「按 X 格式序列化」 and 「已通过 X 校验」 are different
   * statements and only one of them is true here.
   */
  readonly conformanceZh: string;
  readonly generatedAt: string;
  readonly document: T;
  readonly omissions: readonly ExportOmission[];
  /**
   * Contract §B3: 「导出（FHIR / Phenopacket / TREAT-NMD）也带上这个来源，
   * 不能只在 App 里区分而导出里抹平。」
   *
   * ALWAYS PRESENT, and an empty array is a claim, not a shrug: `[]`
   * says no baseline value in this document carries a provenance marker
   * (baseline-provenance.ts). It does not say the patient authored the
   * values. Sorted by path, so a re-export of an unchanged profile is
   * byte-identical.
   */
  readonly fieldOrigins: readonly ExportFieldOrigin[];
  readonly notes: Record<string, string>;
}
