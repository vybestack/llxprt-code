/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  snapshotDirectory,
  BackupClaimCleanupError,
  type ClaimReleaseFn,
} from './backup-operations.js';

describe('snapshotDirectory collision and concurrency', () => {
  let tempDir: string;
  let sourceDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-collision-'));
    sourceDir = path.join(tempDir, 'source');
    backupDir = path.join(tempDir, 'prompt-backup-test');
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'file-0.md'), 'content-0');
    await fs.writeFile(path.join(sourceDir, 'file-1.md'), 'content-1');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('publishes to a suffixed candidate when a directory exists at the requested path', async () => {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, 'existing.txt'), 'pre-existing');

    const result = await snapshotDirectory(sourceDir, backupDir);

    expect(result.success).toBe(true);
    expect(result.backupPath).not.toBe(backupDir);
    expect(result.backupPath.startsWith(backupDir)).toBe(true);

    const existingContent = await fs.readFile(
      path.join(backupDir, 'existing.txt'),
      'utf8',
    );
    expect(existingContent).toBe('pre-existing');

    const files = await fs.readdir(result.backupPath);
    expect(files).toContain('file-0.md');
  });

  it('publishes to a suffixed candidate when a file exists at the requested path', async () => {
    await fs.writeFile(backupDir, 'existing-file-content');

    const result = await snapshotDirectory(sourceDir, backupDir);

    expect(result.backupPath).not.toBe(backupDir);
    const existingContent = await fs.readFile(backupDir, 'utf8');
    expect(existingContent).toBe('existing-file-content');

    const files = await fs.readdir(result.backupPath);
    expect(files).toContain('file-0.md');
  });

  it('concurrent publications do not overwrite each other', async () => {
    const [resultA, resultB] = await Promise.all([
      snapshotDirectory(sourceDir, backupDir),
      snapshotDirectory(sourceDir, backupDir),
    ]);

    // Both succeeded — they must be at different paths.
    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(resultA.backupPath).not.toBe(resultB.backupPath);
  });

  it('surfaces BackupClaimCleanupError with backupPath when release fails after publish', async () => {
    const failingRelease: ClaimReleaseFn = async () =>
      new Error('release failed');

    const error = await snapshotDirectory(sourceDir, backupDir, {
      releaseClaim: failingRelease,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(BackupClaimCleanupError);
    const cleanupError = error as BackupClaimCleanupError;
    expect(cleanupError.backupPath).toBe(backupDir);
    // The backup IS published on disk.
    const files = await fs.readdir(cleanupError.backupPath);
    expect(files).toContain('file-0.md');
  });

  it('cleans up staging directory after a successful snapshot', async () => {
    const result = await snapshotDirectory(sourceDir, backupDir);
    expect(result.success).toBe(true);
    // After completion, no staging directories remain.
    const entries = await fs.readdir(tempDir);
    const stagingLeftovers = entries.filter((e) => e.includes('staging'));
    expect(stagingLeftovers).toHaveLength(0);
  });
});
