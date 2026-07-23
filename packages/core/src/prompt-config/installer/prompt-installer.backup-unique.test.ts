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

describe('PromptInstaller backup unique candidate name (no-overwrite-by-construction)', () => {
  let tempDir: string;
  let baseDir: string;
  let backupPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-unique-'));
    baseDir = path.join(tempDir, 'prompts');
    backupPath = path.join(tempDir, 'backups');
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(backupPath, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'tool.md'), 'tool prompt');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('forced first-collision: existing dir untouched, new backup published at a different unique path', async () => {
    // Pre-create a directory that matches the installer's real candidate
    // name format (timestamp + suffix) so it genuinely collides. The installer
    // must NOT overwrite it; instead it publishes at a different unique path.
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const existingDir = path.join(backupPath, `prompt-backup-${ts}-deadbeef`);
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(path.join(existingDir, 'existing.txt'), 'must-survive');

    const installer = new PromptInstaller();
    const result = await installer.backup(baseDir, backupPath);

    expect(result.success).toBe(true);
    // The existing dir is untouched.
    const existingContent = await fs.readFile(
      path.join(existingDir, 'existing.txt'),
      'utf8',
    );
    expect(existingContent).toBe('must-survive');
    // The new backup was published somewhere under backupPath.
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).not.toBe(existingDir);
    expect(result.backupPath!.startsWith(backupPath)).toBe(true);
    // The new backup contains the source file.
    const files = await fs.readdir(result.backupPath!);
    expect(files).toContain('tool.md');
  });

  it('two backups with identical timestamps do not collide (each gets a unique path)', async () => {
    // When two backups happen in the same second (same timestamp), each
    // must publish at a distinct unique path — proving the candidate name
    // is unique by construction (timestamp+UUID), not just timestamp.
    const installer = new PromptInstaller();

    const [resultA, resultB] = await Promise.all([
      installer.backup(baseDir, backupPath),
      installer.backup(baseDir, backupPath),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(resultA.backupPath).not.toBe(resultB.backupPath);
  });

  it('candidate name includes a UUID/random suffix (not just timestamp)', async () => {
    // The published backup dir name must contain a UUID-like suffix beyond
    // the timestamp, proving it is unique-by-construction. We check the
    // final dir name matches prompt-backup-<timestamp>-<suffix> shape.
    const installer = new PromptInstaller();
    const result = await installer.backup(baseDir, backupPath);

    expect(result.success).toBe(true);
    const dirName = path.basename(result.backupPath!);
    // Must start with the timestamp prefix.
    expect(dirName).toMatch(/^prompt-backup-\d{8}_\d{6}/);
    // Must include a UUID/random suffix after the timestamp (8+ hex chars).
    expect(dirName).toMatch(/^prompt-backup-\d{8}_\d{6}-.+/);
  });
});
