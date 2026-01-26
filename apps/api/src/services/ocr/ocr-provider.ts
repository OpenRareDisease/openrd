export interface OcrResult {
  provider: string;
  extractedText: string;
  fields: Record<string, string>;
  confidence?: number;
  aiExtraction?: unknown;
}

export interface OcrProvider {
  parse: (input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }) => Promise<OcrResult>;
}
