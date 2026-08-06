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
  readonly notes: Record<string, string>;
}
