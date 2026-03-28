import { Client } from 'minio';
import path from 'node:path';
import type { StorageProvider, StoredFile, StoredFileStream } from './storage-provider.js';
import { AppError } from '../../utils/app-error.js';

export const MINIO_PREFIX = 'minio://';
export const isMinioStorageUri = (storageUri: string) => storageUri.startsWith(MINIO_PREFIX);

export interface MinioStorageProviderOptions {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucketName: string;
  useSSL?: boolean;
}

const encodeFileName = (fileName: string) => encodeURIComponent(fileName);
const decodeFileName = (fileName: string | undefined) => {
  if (!fileName) return null;
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
};

const normalizeEndpoint = (endpoint: string, useSSL: boolean) => {
  const normalized = endpoint.includes('://')
    ? endpoint
    : `${useSSL ? 'https' : 'http'}://${endpoint}`;
  const parsed = new URL(normalized);
  return {
    endPoint: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    useSSL: parsed.protocol === 'https:',
  };
};

const buildStorageUri = (bucketName: string, objectName: string) => {
  return `${MINIO_PREFIX}${bucketName}/${objectName}`;
};

const parseStorageUri = (storageUri: string) => {
  if (!isMinioStorageUri(storageUri)) {
    throw new AppError('Unsupported storage uri', 400);
  }

  const parsed = new URL(storageUri);
  const bucketName = parsed.hostname;
  const objectName = parsed.pathname.replace(/^\/+/, '');
  if (!bucketName || !objectName) {
    throw new AppError('Invalid MinIO storage uri', 400);
  }

  return { bucketName, objectName };
};

export class MinioStorageProvider implements StorageProvider {
  private readonly client: Client;
  private readonly bucketName: string;
  private readonly ensuredBuckets = new Map<string, Promise<void>>();

  constructor(options: MinioStorageProviderOptions) {
    const connection = normalizeEndpoint(options.endpoint, options.useSSL ?? false);
    this.client = new Client({
      endPoint: connection.endPoint,
      port: connection.port,
      useSSL: connection.useSSL,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
    this.bucketName = options.bucketName;
  }

  canHandle(storageUri: string) {
    return isMinioStorageUri(storageUri);
  }

  private async ensureBucket(bucketName: string) {
    const existing = this.ensuredBuckets.get(bucketName);
    if (existing) {
      await existing;
      return;
    }

    const pending = (async () => {
      const exists = await this.client.bucketExists(bucketName);
      if (!exists) {
        await this.client.makeBucket(bucketName);
      }
    })();

    this.ensuredBuckets.set(bucketName, pending);

    try {
      await pending;
    } catch (error) {
      this.ensuredBuckets.delete(bucketName);
      throw error;
    }
  }

  async save(input: {
    userId: string;
    fileName: string;
    mimeType: string | null;
    buffer: Buffer;
  }): Promise<StoredFile> {
    await this.ensureBucket(this.bucketName);

    const safeUserId = input.userId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timePrefix = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedName = input.fileName.replace(/[^a-zA-Z0-9-_\.]/g, '_');
    const objectName = `${safeUserId}/${timePrefix}-${sanitizedName}`;

    await this.client.putObject(this.bucketName, objectName, input.buffer, input.buffer.length, {
      'Content-Type': input.mimeType ?? 'application/octet-stream',
      'X-Amz-Meta-Original-File-Name': encodeFileName(input.fileName),
    });

    return {
      storageUri: buildStorageUri(this.bucketName, objectName),
      fileName: path.basename(objectName),
      mimeType: input.mimeType,
      fileSizeBytes: input.buffer.length,
    };
  }

  async load(storageUri: string): Promise<StoredFileStream> {
    const { bucketName, objectName } = parseStorageUri(storageUri);

    try {
      const [stat, stream] = await Promise.all([
        this.client.statObject(bucketName, objectName),
        this.client.getObject(bucketName, objectName),
      ]);

      const meta = stat.metaData ?? {};
      const mimeType = meta['content-type'] ?? meta['Content-Type'] ?? null;
      const originalFileName =
        decodeFileName(
          meta['x-amz-meta-original-file-name'] ??
            meta['X-Amz-Meta-Original-File-Name'] ??
            undefined,
        ) ?? path.basename(objectName);

      return {
        stream,
        fileName: originalFileName,
        mimeType,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/not found|no such key|not exist/i.test(message)) {
        throw new AppError('File not found', 404);
      }
      throw error;
    }
  }
}
