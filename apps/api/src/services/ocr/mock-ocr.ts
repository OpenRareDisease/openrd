import type { OcrProvider, OcrResult } from './ocr-provider.js';

const summaries: Record<string, string> = {
  mri: '检测到 MRI 影像摘要：肌肉信号轻度异常。',
  genetic_report: '检测到遗传报告：疑似 D4Z4 相关变异。',
  blood_panel: '检测到血检报告：肌酸激酶轻度升高。',
  other: '检测到医学报告文本片段。',
};

export class MockOcrProvider implements OcrProvider {
  async parse(input: {
    buffer: Buffer;
    mimeType: string | null;
    documentType: string;
    userId?: string | number;
    fileName?: string;
    reportName?: string;
  }): Promise<OcrResult> {
    const summary = summaries[input.documentType] ?? summaries.other;
    return {
      provider: 'mock',
      extractedText: summary,
      fields: {
        documentType: input.documentType,
        hint: '这是占位 OCR 结果，用于打通流程。',
      },
      confidence: 0.42,
    };
  }
}
