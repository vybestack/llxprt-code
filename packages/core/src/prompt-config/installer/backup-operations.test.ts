/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  BackupVerificationError,
  snapshotDirectory,
} from './backup-operations.js';

async function findStagingDirectory(
  parentDir: string,
  backupName: string,
): Promise<string | undefined> {
  const prefix = `.${backupName}.staging-`;
  const entries = await fs.readdir(parentDir);
  const entry = entries.find((name) => name.startsWith(prefix));
  return entry ? path.join(parentDir, entry) : undefined;
}

describe('atomic prompt backup snapshots', () => {
  let tempDir: string;
  let sourceDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-backup-atomic-'));
    sourceDir = path.join(tempDir, 'source');
    backupDir = path.join(tempDir, 'prompt-backup-test');
    await fs.mkdir(sourceDir);

    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        fs.writeFile(path.join(sourceDir, `file-${index}.md`), `file ${index}`),
      ),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not publish the final backup until staging verification succeeds', async () => {
    const snapshot = snapshotDirectory(sourceDir, backupDir);

    let stagingDir: string | undefined;
    while (stagingDir === undefined) {
      stagingDir = await findStagingDirectory(
        tempDir,
        path.basename(backupDir),
      );
    }

    expect(stagingDir).toBeDefined();
    await expect(fs.stat(backupDir)).rejects.toMatchObject({ code: 'ENOENT' });

    const result = await snapshot;
    expect(result.backupPath).toBe(backupDir);
    await expect(fs.stat(backupDir)).resolves.toBeDefined();
    expect(
      await findStagingDirectory(tempDir, path.basename(backupDir)),
    ).toBeUndefined();
  });

  it('removes staging data and leaves no published backup when verification fails', async () => {
    const snapshot = snapshotDirectory(sourceDir, backupDir);

    let stagingDir: string | undefined;
    while (stagingDir === undefined) {
      stagingDir = await findStagingDirectory(
        tempDir,
        path.basename(backupDir),
      );
    }

    expect(stagingDir).toBeDefined();
    await fs.writeFile(path.join(stagingDir, 'unexpected-file'), 'unexpected');

    await expect(snapshot).rejects.toBeInstanceOf(BackupVerificationError);
    await expect(fs.stat(backupDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await findStagingDirectory(tempDir, path.basename(backupDir)),
    ).toBeUndefined();
  });

  it('publishes to a suffixed candidate when a directory exists at the requested path (EISDIR/non-file deterministic, Finding #4)', async () => {
    // Finding #4: EISDIR/non-file means conservative busy and suffixed
    // publication. When a directory exists at the requested backup path, the
    // snapshot must NOT replace it (no rename over a non-file). Instead, it
    // publishes to a unique suffixed candidate so both survive.
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, 'existing.txt'), 'pre-existing');

    const result = await snapshotDirectory(sourceDir, backupDir);

    // The backup was published to a DIFFERENT (suffixed) path.
    expect(result.success).toBe(true);
    expect(result.backupPath).not.toBe(backupDir);
    expect(result.backupPath.startsWith(backupDir)).toBe(true);

    // The original directory was NOT replaced.
    const existingContent = await fs.readFile(
      path.join(backupDir, 'existing.txt'),
      'utf8',
    );
    expect(existingContent).toBe('pre-existing');

    // The suffixed backup contains the source content.
    const files = await fs.readdir(result.backupPath);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('file-0.md');
  });

  it('publishes to a suffixed candidate when an existing file exists at the requested path (content collision)', async () => {
    // Finding #4: when existing content (a regular file) exists at the
    // requested path, the snapshot publishes to a suffixed candidate.
    // The existing file is NEVER replaced.
    await fs.writeFile(backupDir, 'existing-file-content');

    const result = await snapshotDirectory(sourceDir, backupDir);

    expect(result.success).toBe(true);
    expect(result.backupPath).not.toBe(backupDir);

    // The existing file was NOT replaced.
    const existingContent = await fs.readFile(backupDir, 'utf8');
    expect(existingContent).toBe('existing-file-content');

    // The suffixed backup has the source content.
    const files = await fs.readdir(result.backupPath);
    expect(files).toContain('file-0.md');
  });
});
