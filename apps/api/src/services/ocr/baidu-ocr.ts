import {
  OCR_PROCESSOR_DISCLOSURES,
  type OcrProcessorDisclosure,
  type OcrProvider,
  type OcrResult,
} from './ocr-provider.js';
import { AppError } from '../../utils/app-error.js';

/**
 * THIS PROVIDER SENDS PATIENT REPORTS TO A THIRD PARTY.
 *
 * `parse` base64-encodes the uploaded file — an MRI, a genetic report,
 * a blood panel — and POSTs it to Baidu's cloud OCR. 隐私政策 §3(三)
 * currently tells patients 「OCR 在我们自己的服务器上完成，不外发给第
 * 三方识别服务」 and §5 introduces its recipient list as 「以下是全部对
 * 外提供与委托处理的情形」 without naming an OCR vendor, so selecting
 * this mode makes a published legal document false about the most
 * sensitive flow in the product. That is a PIPL Art. 23 委托处理
 * disclosure plus Art. 29 单独同意, neither of which exists yet.
 *
 * Nothing in this repo selects it (docker-compose, .env.example and
 * every deploy doc pin `embedded`), and the code cannot make the policy
 * text true on its own. What it can do — and now does — is stop being
 * silent about it: every parse stamps `OCR_PROCESSOR_DISCLOSURES.baidu`
 * onto the stored document, and the health summary reports the
 * residency for the configured mode. Before removing that plumbing,
 * check that §5 names 百度智能云 and that a DPA exists.
 */
interface BaiduOcrConfig {
  apiKey: string;
  secretKey: string;
  generalEndpoint: string;
  accurateEndpoint: string;
  medicalEndpoint: string;
  requestTimeoutMs: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface WordsResultItem {
  words?: string;
}

interface BaiduOcrPayload {
  words_result?: WordsResultItem[] | string;
  result?: WordsResultItem[];
  error_code?: number;
  error_msg?: string;
  error?: string;
  error_description?: string;
  access_token?: string;
  expires_in?: number | string;
}

const DEFAULT_GENERAL_ENDPOINT = 'https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic';
const DEFAULT_ACCURATE_ENDPOINT = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';
const DEFAULT_MEDICAL_ENDPOINT = 'https://aip.baidubce.com/rest/2.0/ocr/v1/medical_report';

/**
 * Matches the embedded parser's default (OCR_PARSER_TIMEOUT_MS, 120s).
 *
 * `fetch` has no timeout of its own, so without this a Baidu endpoint
 * that accepts the connection and then never answers holds the promise
 * open forever. The caller is `startOcrJob`, which runs inside
 * `ocrLimiter` — a bounded concurrency pool — so one hung request does
 * not just lose one document: it permanently consumes a slot, and after
 * OCR_MAX_CONCURRENT_PARSES of them every subsequent upload queues
 * behind requests that will never finish, with the document row stuck
 * at 'processing' and the patient seeing 「识别中」 forever.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const hostOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
};

const pickEndpoint = (documentType: string, config: BaiduOcrConfig) => {
  switch (documentType) {
    case 'mri':
    case 'genetic_report':
    case 'blood_panel':
      return config.medicalEndpoint;
    default:
      return config.accurateEndpoint || config.generalEndpoint;
  }
};

const extractTextFromResponse = (payload: BaiduOcrPayload) => {
  if (Array.isArray(payload.words_result)) {
    return payload.words_result
      .map((item) => item.words)
      .filter(Boolean)
      .join('\n');
  }

  if (Array.isArray(payload.result)) {
    return payload.result
      .map((item) => item.words)
      .filter(Boolean)
      .join('\n');
  }

  if (typeof payload.words_result === 'string') {
    return payload.words_result;
  }

  return '';
};

export class BaiduOcrProvider implements OcrProvider {
  readonly disclosure: OcrProcessorDisclosure;
  private readonly config: BaiduOcrConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: Partial<BaiduOcrConfig>) {
    if (!config.apiKey || !config.secretKey) {
      throw new AppError('Missing Baidu OCR credentials', 500);
    }

    this.config = {
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      generalEndpoint: config.generalEndpoint ?? DEFAULT_GENERAL_ENDPOINT,
      accurateEndpoint: config.accurateEndpoint ?? DEFAULT_ACCURATE_ENDPOINT,
      medicalEndpoint: config.medicalEndpoint ?? DEFAULT_MEDICAL_ENDPOINT,
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
    // The medical endpoint is the one every MRI / 基因报告 / 血检 goes
    // to, so it is the host a caller stamping a *failed* parse should
    // name — a Baidu parse that throws has usually already uploaded the
    // file.
    this.disclosure = this.disclosureFor(this.config.medicalEndpoint);
  }

  /**
   * The disclosure stamped onto every document this provider parses.
   *
   * `endpointHost` is read off the configured endpoint rather than
   * copied from the constant, because BAIDU_OCR_*_ENDPOINT is an env
   * var: pointing it at a proxy or a non-`.cn` region changes where the
   * report actually goes, and a disclosure that keeps saying
   * aip.baidubce.com would be exactly the confident-but-wrong record
   * this field exists to replace.
   */
  private disclosureFor(endpoint: string): OcrProcessorDisclosure {
    return {
      ...OCR_PROCESSOR_DISCLOSURES.baidu,
      endpointHost: hostOf(endpoint) ?? OCR_PROCESSOR_DISCLOSURES.baidu.endpointHost,
    };
  }

  async parse(input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }): Promise<OcrResult> {
    const token = await this.getAccessToken();
    const endpoint = pickEndpoint(input.documentType, this.config);
    const base64 = input.buffer.toString('base64');

    const params = new URLSearchParams();
    params.set('image', base64);

    const response = await this.postForm(
      `${endpoint}?access_token=${encodeURIComponent(token)}`,
      params,
      'Baidu OCR',
    );

    const payload = (await response.json()) as BaiduOcrPayload;

    if (!response.ok || payload.error_code) {
      const message = payload.error_msg || payload.error_code || response.statusText;
      throw new AppError(`Baidu OCR failed: ${message}`, 502);
    }

    const extractedText = extractTextFromResponse(payload);

    return {
      provider: 'baidu',
      // Stamped on the document itself. Once this row is written, the
      // answer to 「这份报告外发过吗」 no longer depends on remembering
      // what OCR_PROVIDER was set to on the day it was uploaded.
      disclosure: this.disclosureFor(endpoint),
      extractedText,
      fields: {
        documentType: input.documentType,
      },
    };
  }

  /** Single place the timeout is applied, so the token exchange cannot
   *  hang either — it runs before every parse, inside the same limiter
   *  slot. */
  private async postForm(url: string, body: URLSearchParams, label: string) {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new AppError(`${label} timed out after ${this.config.requestTimeoutMs}ms`, 504);
      }
      throw error;
    }
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.token;
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    params.set('client_id', this.config.apiKey);
    params.set('client_secret', this.config.secretKey);

    const response = await this.postForm(
      'https://aip.baidubce.com/oauth/2.0/token',
      params,
      'Baidu OCR token exchange',
    );

    const payload = (await response.json()) as BaiduOcrPayload;

    if (!response.ok || !payload.access_token) {
      const message = payload.error_description || payload.error || response.statusText;
      throw new AppError(`Failed to fetch Baidu OCR token: ${message}`, 502);
    }

    const expiresIn = Number(payload.expires_in ?? 0);
    this.tokenCache = {
      token: payload.access_token,
      expiresAt: now + expiresIn * 1000,
    };

    return payload.access_token as string;
  }
}
