/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  ensureBaselineBackup,
  formatTimestampKey,
  getBackupBasePath,
  getBackupsRootDir,
  writeBackupPair,
} from '../edit-backups.js';

describe('edit backups', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'edit-backups-test-'),
    );
  });

  it('formatTimestampKey returns stable UTC sortable key', () => {
    const d = new Date(Date.UTC(2025, 11, 24, 10, 11, 12, 123));
    expect(formatTimestampKey(d)).toBe('20251224_101112_123');
  });

  it('getBackupBasePath rejects unsafe relativeFilePath that would escape backups root', () => {
    expect(() =>
      getBackupBasePath(projectRoot, '../other/file.txt', 'baseline'),
    ).toThrow(/traverse|escape|relativeFilePath/i);
  });

  it('ensureBaselineBackup writes baseline only once', async () => {
    const relativeFilePath = 'src/foo.ts';
    const originalFilePath = path.join(projectRoot, relativeFilePath);

    const first = await ensureBaselineBackup({
      projectRoot,
      relativeFilePath,
      originalFilePath,
      baselineContent: 'v1',
    });

    expect(first.created).toBe(true);
    expect(first.backupFilePath).toBe(
      path.join(getBackupsRootDir(projectRoot), relativeFilePath) + '_baseline',
    );

    const second = await ensureBaselineBackup({
      projectRoot,
      relativeFilePath,
      originalFilePath,
      baselineContent: 'v2',
    });

    expect(second.created).toBe(false);

    const baselineText = await fs.readFile(first.backupFilePath, 'utf-8');
    expect(baselineText).toBe('v1');
  });

  it('ensureBaselineBackup recreates missing baseline sidecar metadata without overwriting the baseline', async () => {
    const relativeFilePath = 'src/with-sidecar.txt';
    const originalFilePath = path.join(projectRoot, relativeFilePath);

    const first = await ensureBaselineBackup({
      projectRoot,
      relativeFilePath,
      originalFilePath,
      baselineContent: 'baseline-v1',
    });
    expect(first.created).toBe(true);

    // Simulate partial failure where the baseline content was created but the sidecar was lost.
    await fs.unlink(first.metadataFilePath);

    const second = await ensureBaselineBackup({
      projectRoot,
      relativeFilePath,
      originalFilePath,
      baselineContent: 'baseline-v2-should-not-overwrite',
    });

    expect(second.created).toBe(false);

    // Baseline blob must remain authoritative.
    const baselineText = await fs.readFile(first.backupFilePath, 'utf-8');
    expect(baselineText).toBe('baseline-v1');

    // Sidecar should be recreated.
    const meta = JSON.parse(
      await fs.readFile(first.metadataFilePath, 'utf-8'),
    ) as {
      kind: string;
      timestampKey: string;
    };
    expect(meta.kind).toBe('baseline');
    expect(meta.timestampKey).toBe('baseline');
  });

  it('writeBackupPair writes both content and metadata JSON next to it', async () => {
    const relativeFilePath = 'a/b/c.txt';
    const originalFilePath = path.join(projectRoot, relativeFilePath);
    const timestampKey = '20251224_101112_123';

    const { backupFilePath, metadataFilePath } = await writeBackupPair({
      projectRoot,
      relativeFilePath,
      originalFilePath,
      timestampKey,
      kind: 'revision',
      title: 'my edit title',
      content: 'hello',
    });

    expect(backupFilePath).toBe(
      getBackupBasePath(projectRoot, relativeFilePath, timestampKey),
    );

    expect(await fs.readFile(backupFilePath, 'utf-8')).toBe('hello');

    const meta = JSON.parse(await fs.readFile(metadataFilePath, 'utf-8')) as {
      kind: string;
      timestampKey: string;
      title?: string;
      relativeFilePath: string;
      originalFilePath: string;
      createdAtIso: string;
    };

    expect(meta.kind).toBe('revision');
    expect(meta.timestampKey).toBe(timestampKey);
    expect(meta.title).toBe('my edit title');
    expect(meta.relativeFilePath).toBe(relativeFilePath);
    expect(meta.originalFilePath).toBe(originalFilePath);
    expect(typeof meta.createdAtIso).toBe('string');
  });
});
