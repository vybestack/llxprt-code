/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PromptInstaller } from '../prompt-installer.js';

describe('PromptInstaller backup partial-success (BackupClaimCleanupError)', () => {
  let tempDir: string;
  let baseDir: string;
  let backupPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-cleanup-'));
    baseDir = path.join(tempDir, 'prompts');
    backupPath = path.join(tempDir, 'backups');
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(backupPath, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'tool.md'), 'tool prompt');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns {success:false, backupPath, error} when backup is published but cleanup fails', async () => {
    const installer = new PromptInstaller({
      backup: {
        releaseClaim: async () => new Error('cleanup failed'),
      },
    });

    const result = await installer.backup(baseDir, backupPath);

    expect(result.success).toBe(false);
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).not.toBe('');
    expect(result.error).toBeDefined();

    // The backup IS published on disk.
    const entries = await fs.readdir(backupPath);
    const backupDir = entries.find((e) => e.startsWith('prompt-backup-'));
    expect(backupDir).toBeDefined();
    const files = await fs.readdir(path.join(backupPath, backupDir!));
    expect(files).toContain('tool.md');
  });
});
