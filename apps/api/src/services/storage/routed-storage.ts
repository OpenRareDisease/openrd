import type { StorageProvider, StoredFile, StoredFileStream } from './storage-provider.js';
import { AppError } from '../../utils/app-error.js';

export interface RoutedStorageProviderOptions {
  primary: StorageProvider;
  providers: StorageProvider[];
}

export class RoutedStorageProvider implements StorageProvider {
  private readonly primary: StorageProvider;
  private readonly providers: StorageProvider[];

  constructor(options: RoutedStorageProviderOptions) {
    this.primary = options.primary;
    this.providers = options.providers;
  }

  canHandle(storageUri: string) {
    return this.providers.some((provider) => provider.canHandle(storageUri));
  }

  async save(input: {
    userId: string;
    fileName: string;
    mimeType: string | null;
    buffer: Buffer;
  }): Promise<StoredFile> {
    return this.primary.save(input);
  }

  async load(storageUri: string): Promise<StoredFileStream> {
    const provider = this.providers.find((candidate) => candidate.canHandle(storageUri));
    if (!provider) {
      throw new AppError('Unsupported storage uri', 400);
    }
    return provider.load(storageUri);
  }

  async remove(storageUri: string): Promise<void> {
    const provider = this.providers.find((candidate) => candidate.canHandle(storageUri));
    if (!provider) {
      throw new AppError('Unsupported storage uri', 400);
    }
    await provider.remove(storageUri);
  }
}
