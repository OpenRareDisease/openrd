import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RoutedStorageProvider } from './routed-storage.js';
import type { StorageProvider } from './storage-provider.js';

const createProvider = (prefix: string): StorageProvider => ({
  canHandle: (storageUri: string) => storageUri.startsWith(prefix),
  save: async ({ fileName, mimeType, buffer }) => ({
    storageUri: `${prefix}${fileName}`,
    fileName,
    mimeType,
    fileSizeBytes: buffer.length,
  }),
  load: async (storageUri: string) => ({
    stream: Readable.from([storageUri]),
    fileName: storageUri.slice(prefix.length),
    mimeType: 'application/octet-stream',
  }),
});

describe('RoutedStorageProvider', () => {
  it('saves using the primary provider and loads by uri prefix', async () => {
    const local = createProvider('local://');
    const minio = createProvider('minio://');
    const storage = new RoutedStorageProvider({
      primary: minio,
      providers: [local, minio],
    });

    const saved = await storage.save({
      userId: 'u1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('data'),
    });
    expect(saved.storageUri).toBe('minio://report.pdf');

    const loaded = await storage.load('local://legacy.pdf');
    expect(loaded.fileName).toBe('legacy.pdf');
  });
});
