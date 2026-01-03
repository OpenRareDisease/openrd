import type { Readable } from 'node:stream';

export interface StoredFile {
  storageUri: string;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number;
}

export interface StoredFileStream {
  stream: Readable;
  fileName: string;
  mimeType: string | null;
}

export interface StorageProvider {
  save: (input: {
    userId: string;
    fileName: string;
    mimeType: string | null;
    buffer: Buffer;
  }) => Promise<StoredFile>;
  load: (storageUri: string) => Promise<StoredFileStream>;
}
