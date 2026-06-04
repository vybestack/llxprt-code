/**
 * Tests for ensure-dirs.ts
 *
 * This file tests the ensureParentDirectoriesExist function that will be
 * extracted during Phase 1 decomposition.
 *
 * Coverage: ensureParentDirectoriesExist behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureParentDirectoriesExist } from '../ensure-dirs.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('ensureParentDirectoriesExist', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensure-dirs-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create parent directories when they don't exist", async () => {
    const testFilePath = path.join(tempDir, 'a', 'b', 'c', 'file.txt');

    // Verify parent directories don't exist
    await expect(fs.access(path.join(tempDir, 'a'))).rejects.toThrow(/ENOENT/);

    // Call the function
    await ensureParentDirectoriesExist(testFilePath);

    // Verify parent directories were created
    await expect(fs.access(path.join(tempDir, 'a'))).resolves.not.toThrow();
    await expect(
      fs.access(path.join(tempDir, 'a', 'b')),
    ).resolves.not.toThrow();
    await expect(
      fs.access(path.join(tempDir, 'a', 'b', 'c')),
    ).resolves.not.toThrow();
  });

  it('should not throw when parent directories already exist', async () => {
    // Create parent directories first
    const testFilePath = path.join(tempDir, 'existing', 'path', 'file.txt');
    await fs.mkdir(path.join(tempDir, 'existing', 'path'), { recursive: true });

    // Call the function - should not throw
    await expect(
      ensureParentDirectoriesExist(testFilePath),
    ).resolves.not.toThrow();

    // Verify directories still exist
    await expect(
      fs.access(path.join(tempDir, 'existing')),
    ).resolves.not.toThrow();
    await expect(
      fs.access(path.join(tempDir, 'existing', 'path')),
    ).resolves.not.toThrow();
  });

  it('should handle nested directory creation', async () => {
    const testFilePath = path.join(
      tempDir,
      'deeply',
      'nested',
      'directory',
      'structure',
      'file.txt',
    );

    await ensureParentDirectoriesExist(testFilePath);

    // Verify all parent directories were created
    await expect(
      fs.access(path.join(tempDir, 'deeply')),
    ).resolves.not.toThrow();
    await expect(
      fs.access(path.join(tempDir, 'deeply', 'nested')),
    ).resolves.not.toThrow();
    await expect(
      fs.access(path.join(tempDir, 'deeply', 'nested', 'directory')),
    ).resolves.not.toThrow();
    await expect(
      fs.access(
        path.join(tempDir, 'deeply', 'nested', 'directory', 'structure'),
      ),
    ).resolves.not.toThrow();
  });
});
