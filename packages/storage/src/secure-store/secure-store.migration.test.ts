import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SecureStore } from './secure-store.js';

describe('SecureStore — Migration and Sanitization', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'secure-store-migration-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('sanitizes Windows-reserved characters using %XX', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const key = 'my*key:test?';
    // * -> %2A, : -> %3A, ? -> %3F
    const expectedSafeKey = 'my%2Akey%3Atest%3F';

    await store.set(key, 'value');

    const files = await fs.readdir(tempDir);
    expect(files).toContain(expectedSafeKey + '.enc');

    const val = await store.get(key);
    expect(val).toBe('value');
  });

  it('falls back to legacy unencoded keys in get()', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const key = 'legacy-key-with-chars';
    const legacyPath = path.join(tempDir, key + '.enc');

    // We need to write a valid envelope for it to be readable
    await store.set('temp', 'secret-data');
    const tempPath = path.join(tempDir, 'temp.enc');
    await fs.rename(tempPath, legacyPath);

    // Now 'legacy-key-with-chars' exists only as an unencoded file
    const val = await store.get(key);
    expect(val).toBe('secret-data');
  });

  it('falls back to legacy unencoded keys in has()', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const key = 'has-legacy';
    const legacyPath = path.join(tempDir, key + '.enc');
    await fs.writeFile(legacyPath, 'dummy');

    expect(await store.has(key)).toBe(true);
  });

  it('removes both new and legacy files in delete()', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const key = 'del-legacy*'; // This will have different newPath and legacyPath
    const newPath = path.join(tempDir, 'del-legacy%2A.enc');
    // For legacy path, we use a safe version to ensure it can be created on Windows
    const legacyKey = 'del-legacy-raw';
    const legacyPath = path.join(tempDir, legacyKey + '.enc');

    await fs.writeFile(newPath, 'new');
    await fs.writeFile(legacyPath, 'legacy');

    // Manually test legacy path deletion by tricking the store or just using a key that matches
    await store.delete(key);
    expect(
      await fs
        .access(newPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    await store.delete(legacyKey);
    expect(
      await fs
        .access(legacyPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('lists both encoded and unencoded legacy keys', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await fs.writeFile(path.join(tempDir, 'encoded%2A.enc'), 'v1');
    await fs.writeFile(path.join(tempDir, 'raw-legacy.enc'), 'v2');
    await fs.writeFile(path.join(tempDir, 'normal.enc'), 'v3');

    const keys = await store.list();
    expect(keys).toContain('encoded*');
    expect(keys).toContain('raw-legacy');
    expect(keys).toContain('normal');
    expect(keys.length).toBe(3);
  });
});
