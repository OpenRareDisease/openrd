import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { StorageProvider, StoredFile, StoredFileStream } from './storage-provider.js';
import { AppError } from '../../utils/app-error.js';

const LOCAL_PREFIX = 'local://';

const getUploadsRoot = () => {
  return path.resolve(process.cwd(), 'uploads');
};

const ensureUploadsRoot = async () => {
  const root = getUploadsRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
};

const buildStorageUri = (relativePath: string) => `${LOCAL_PREFIX}${relativePath}`;

const parseStorageUri = (storageUri: string) => {
  if (!storageUri.startsWith(LOCAL_PREFIX)) {
    throw new AppError('Unsupported storage uri', 400);
  }
  return storageUri.slice(LOCAL_PREFIX.length);
};

export class LocalStorageProvider implements StorageProvider {
  async save(input: {
    userId: string;
    fileName: string;
    mimeType: string | null;
    buffer: Buffer;
  }): Promise<StoredFile> {
    const root = await ensureUploadsRoot();
    const safeUserId = input.userId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const userDir = path.join(root, safeUserId);
    await fs.mkdir(userDir, { recursive: true });

    const timePrefix = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedName = input.fileName.replace(/[^a-zA-Z0-9-_\.]/g, '_');
    const storedFileName = `${timePrefix}-${sanitizedName}`;
    const absolutePath = path.join(userDir, storedFileName);

    await fs.writeFile(absolutePath, input.buffer);

    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');

    return {
      storageUri: buildStorageUri(relativePath),
      fileName: storedFileName,
      mimeType: input.mimeType,
      fileSizeBytes: input.buffer.length,
    };
  }

  async load(storageUri: string): Promise<StoredFileStream> {
    const root = await ensureUploadsRoot();
    const relativePath = parseStorageUri(storageUri);
    const absolutePath = path.join(root, relativePath);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new AppError('File not found', 404);
    }

    return {
      stream: createReadStream(absolutePath),
      fileName: path.basename(absolutePath),
      mimeType: null,
    };
  }
}
