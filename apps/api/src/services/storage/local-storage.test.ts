import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorageProvider, LOCAL_PREFIX } from './local-storage.js';
import { AppError } from '../../utils/app-error.js';

const provider = new LocalStorageProvider();

let workdir: string;
let originalCwd: string;
let secretPath: string;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'localstorage-test-'));
  // A file *outside* the uploads sandbox we expect path-traversal
  // attempts to reach. We assert the provider refuses to touch it.
  secretPath = path.join(workdir, 'secret.txt');
  await fs.writeFile(secretPath, 'TOP_SECRET');
  originalCwd = process.cwd();
  process.chdir(workdir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(workdir, { recursive: true, force: true });
});

describe('LocalStorageProvider — path containment', () => {
  it('round-trips a save -> load with the storage uri it returned', async () => {
    const saved = await provider.save({
      userId: 'user-1',
      fileName: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    expect(saved.storageUri.startsWith(LOCAL_PREFIX)).toBe(true);
    const loaded = await provider.load(saved.storageUri);
    expect(loaded.fileName).toMatch(/note\.txt$/);
  });

  it('rejects a traversal uri that escapes the uploads root', async () => {
    // local://../secret.txt would resolve to <workdir>/secret.txt
    // which sits outside <workdir>/uploads/.
    await expect(provider.load(`${LOCAL_PREFIX}../secret.txt`)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a deeply nested traversal', async () => {
    await expect(provider.load(`${LOCAL_PREFIX}foo/../../secret.txt`)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('rejects an absolute path embedded in the uri', async () => {
    await expect(provider.load(`${LOCAL_PREFIX}${secretPath}`)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a NUL byte injection', async () => {
    await expect(provider.load(`${LOCAL_PREFIX}note\0.txt`)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects non-local prefixes', async () => {
    await expect(provider.load('minio://foo')).rejects.toBeInstanceOf(AppError);
  });
});
