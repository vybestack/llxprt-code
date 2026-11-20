/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir as tempDirectory } from '../journal/__tests__/support/useTempDir.js';
import { LocalMediaStoreFiles } from './local-media-store-files.js';

const directory = tempDirectory('media-directory-verification-');

describe('managed media directory verification', () => {
  it('verifies existing directories without attempting to create them', async () => {
    const files = new LocalMediaStoreFiles(
      join(directory(), 'media'),
      undefined,
    );
    await files.ensureDirectories(undefined);
    const creation = spyOn(fs, 'mkdir').mockImplementation(async () => {
      throw new Error('Directory creation is unavailable');
    });
    try {
      await expect(files.ensureDirectories(undefined)).resolves.toBeUndefined();
      expect((await fs.lstat(files.objectDirectory)).isDirectory()).toBe(true);
    } finally {
      creation.mockRestore();
    }
  });
});
