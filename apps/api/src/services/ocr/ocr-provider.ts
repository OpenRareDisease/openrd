/**
 * Where a patient's report file is actually parsed.
 *
 * `on_premise` — the bytes never leave a process we run.
 * `third_party` — the bytes are transmitted to an external processor.
 *
 * This is not decoration, and it is not derivable from `provider`
 * alone. 隐私政策 §3(三) tells patients 「OCR 在我们自己的服务器上完成，
 * 不外发给第三方识别服务」, and `OCR_PROVIDER=baidu` makes that sentence
 * false: baidu-ocr.ts base64-encodes the uploaded MRI / 基因报告 and
 * POSTs it to aip.baidubce.com. Nothing recorded that. The stored
 * document said `provider: 'baidu'` — a name, meaningless to anyone who
 * has not read this directory — the health summary said `ocr: ok`, and
 * the only real record of which patients' reports were handed to a
 * vendor was the value of an env var at some past moment, which is not
 * a record at all.
 *
 * So every provider declares it, `OcrResult` carries it into
 * `patient_documents.ocr_payload`, and the health summary reports it.
 * 「这份报告有没有外发？外发给谁？」 becomes answerable per document and
 * per deploy instead of per memory.
 */
export type OcrDataResidency = 'on_premise' | 'third_party';

export interface OcrProcessorDisclosure {
  residency: OcrDataResidency;
  /**
   * The recipient, named the way 隐私政策 §5 names recipients — because
   * §5 is where this has to appear for the disclosure to be lawful, and
   * a mismatch between the two strings is the bug we want to be able to
   * see. `null` when nothing is transmitted.
   */
  processor: string | null;
  /**
   * The host the document bytes are POSTed to. Lets an operator confirm
   * the jurisdiction from the health summary without reading provider
   * code — a `.cn` host is an Art. 23 委托处理 disclosure, a non-`.cn`
   * host is additionally an Art. 38 cross-border transfer.
   */
  endpointHost: string | null;
}

export const ON_PREMISE_OCR: OcrProcessorDisclosure = {
  residency: 'on_premise',
  processor: null,
  endpointHost: null,
};

/**
 * Disclosure per `OCR_PROVIDER` value, so the health check can answer
 * for a mode without constructing its provider.
 *
 * Keyed by the env enum on purpose: adding a fourth OCR mode to
 * env.ts's `z.enum` without stating where that mode sends the file is a
 * compile error here, not a silent omission from the health summary.
 */
export type OcrProviderMode = 'embedded' | 'baidu' | 'mock';

export const OCR_PROCESSOR_DISCLOSURES: Record<OcrProviderMode, OcrProcessorDisclosure> = {
  embedded: ON_PREMISE_OCR,
  mock: ON_PREMISE_OCR,
  baidu: {
    residency: 'third_party',
    // Same register as 隐私政策 §5 uses for 硅基流动 SiliconFlow.
    processor: '百度智能云（Baidu AI Cloud）OCR',
    endpointHost: 'aip.baidubce.com',
  },
};

export interface OcrResult {
  provider: string;
  /**
   * Recorded on every parse so the row itself, not an operator's
   * recollection of the env at upload time, says whether this patient's
   * file left our servers.
   */
  disclosure: OcrProcessorDisclosure;
  extractedText: string;
  fields: Record<string, string>;
  confidence?: number;
  aiExtraction?: unknown;
}

export interface OcrProvider {
  /**
   * The same disclosure `parse` stamps on its result, readable without
   * running a parse.
   *
   * It exists for the failure path. `startOcrJob` catches a throw and
   * writes `{ provider: 'unknown', error }` — but a Baidu parse that
   * throws has usually already uploaded the file, so 'unknown' is the
   * one case where the stored row is actively wrong about whether this
   * patient's report left our servers. A caller that lands a failure
   * result should stamp `this.ocr.disclosure` onto it.
   */
  readonly disclosure: OcrProcessorDisclosure;
  parse: (input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }) => Promise<OcrResult>;
}
