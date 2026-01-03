export interface OcrResult {
  provider: string;
  extractedText: string;
  fields: Record<string, string>;
  confidence?: number;
}

export interface OcrProvider {
  parse: (input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
  }) => Promise<OcrResult>;
}
