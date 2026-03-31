import type { OcrProvider, OcrResult } from './ocr-provider.js';
import { AppError } from '../../utils/app-error.js';

interface BaiduOcrConfig {
  apiKey: string;
  secretKey: string;
  generalEndpoint: string;
  accurateEndpoint: string;
  medicalEndpoint: string;
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

    const response = await fetch(`${endpoint}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const payload = (await response.json()) as BaiduOcrPayload;

    if (!response.ok || payload.error_code) {
      const message = payload.error_msg || payload.error_code || response.statusText;
      throw new AppError(`Baidu OCR failed: ${message}`, 502);
    }

    const extractedText = extractTextFromResponse(payload);

    return {
      provider: 'baidu',
      extractedText,
      fields: {
        documentType: input.documentType,
      },
    };
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

    const response = await fetch('https://aip.baidubce.com/oauth/2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

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
