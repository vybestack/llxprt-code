/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

export const BACKUPS_DIR_NAME = '.backups';
const BASELINE_KEY = 'baseline';

export type BackupKind = 'baseline' | 'revision';

export interface BackupMetadata {
  kind: BackupKind;
  timestampKey: string;
  title?: string;
  // relative path from project root (targetDir) to original file
  relativeFilePath: string;
  originalFilePath: string;
  createdAtIso: string;
}

export function formatTimestampKey(d: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return (
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1, 2) +
    pad(d.getUTCDate(), 2) +
    '_' +
    pad(d.getUTCHours(), 2) +
    pad(d.getUTCMinutes(), 2) +
    pad(d.getUTCSeconds(), 2) +
    '_' +
    pad(d.getUTCMilliseconds(), 3)
  );
}

export function getBackupsRootDir(projectRoot: string): string {
  return path.join(projectRoot, BACKUPS_DIR_NAME);
}

export function getBackupBasePath(
  projectRoot: string,
  relativeFilePath: string,
  timestampKey: string,
): string {
  const backupsRoot = getBackupsRootDir(projectRoot);

  // Defensive: ensure the provided path can't escape the backups root.
  // (e.g. "../other/file" would otherwise be allowed by path.join)
  if (path.isAbsolute(relativeFilePath)) {
    throw new Error(
      `relativeFilePath must not be absolute: ${relativeFilePath}`,
    );
  }

  const normalized = path.normalize(relativeFilePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(
      `relativeFilePath must not traverse outside the project root: ${relativeFilePath}`,
    );
  }

  // Important: we append the key to the base file name with an underscore.
  // Examples:
  // - baseline:  .backups/src/foo.ts_baseline
  // - revision:  .backups/src/foo.ts_20251224_101112_123
  return path.join(backupsRoot, relativeFilePath) + `_${timestampKey}`;
}

export function getBaselineBasePath(
  projectRoot: string,
  relativeFilePath: string,
): string {
  return getBackupBasePath(projectRoot, relativeFilePath, BASELINE_KEY);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirForFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeFileExclusive(
  filePath: string,
  content: string,
): Promise<void> {
  await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
}

async function writeMetadataSidecarExclusive(params: {
  metadataFilePath: string;
  kind: BackupKind;
  timestampKey: string;
  title?: string;
  relativeFilePath: string;
  originalFilePath: string;
}): Promise<void> {
  const meta: BackupMetadata = {
    kind: params.kind,
    timestampKey: params.timestampKey,
    title: params.title,
    relativeFilePath: params.relativeFilePath,
    originalFilePath: params.originalFilePath,
    createdAtIso: new Date().toISOString(),
  };

  await writeFileExclusive(
    params.metadataFilePath,
    JSON.stringify(meta, null, 2),
  );
}

export async function writeBackupPair(params: {
  projectRoot: string;
  relativeFilePath: string;
  originalFilePath: string;
  timestampKey: string;
  kind: BackupKind;
  title?: string;
  content: string;
}): Promise<{ backupFilePath: string; metadataFilePath: string }> {
  const basePath = getBackupBasePath(
    params.projectRoot,
    params.relativeFilePath,
    params.timestampKey,
  );

  const backupFilePath = basePath;
  const metadataFilePath = `${basePath}.json`;

  await ensureDirForFile(backupFilePath);

  const meta: BackupMetadata = {
    kind: params.kind,
    timestampKey: params.timestampKey,
    title: params.title,
    relativeFilePath: params.relativeFilePath,
    originalFilePath: params.originalFilePath,
    createdAtIso: new Date().toISOString(),
  };

  await writeFileExclusive(backupFilePath, params.content);
  await writeFileExclusive(metadataFilePath, JSON.stringify(meta, null, 2));

  return { backupFilePath, metadataFilePath };
}

export async function ensureBaselineBackup(params: {
  projectRoot: string;
  relativeFilePath: string;
  originalFilePath: string;
  baselineContent: string;
}): Promise<{
  created: boolean;
  backupFilePath: string;
  metadataFilePath: string;
}> {
  const basePath = getBaselineBasePath(
    params.projectRoot,
    params.relativeFilePath,
  );
  const backupFilePath = basePath;
  const metadataFilePath = `${basePath}.json`;

  const exists = await fileExists(backupFilePath);
  if (exists) {
    const metadataExists = await fileExists(metadataFilePath);
    if (metadataExists) {
      return { created: false, backupFilePath, metadataFilePath };
    }

    // Baseline blob exists but sidecar metadata is missing.
    // Recreate the metadata sidecar without touching the baseline snapshot.
    try {
      await writeMetadataSidecarExclusive({
        metadataFilePath,
        kind: 'baseline',
        timestampKey: BASELINE_KEY,
        title: 'baseline',
        relativeFilePath: params.relativeFilePath,
        originalFilePath: params.originalFilePath,
      });
    } catch (e: unknown) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code?: unknown }).code
          : undefined;

      if (code !== 'EEXIST') {
        throw e;
      }
    }

    return { created: false, backupFilePath, metadataFilePath };
  }

  try {
    const { backupFilePath: b, metadataFilePath: m } = await writeBackupPair({
      projectRoot: params.projectRoot,
      relativeFilePath: params.relativeFilePath,
      originalFilePath: params.originalFilePath,
      timestampKey: BASELINE_KEY,
      kind: 'baseline',
      title: 'baseline',
      content: params.baselineContent,
    });

    return { created: true, backupFilePath: b, metadataFilePath: m };
  } catch (e: unknown) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code?: unknown }).code
        : undefined;

    if (code === 'EEXIST') {
      return { created: false, backupFilePath, metadataFilePath };
    }

    throw e;
  }
}

export async function createEditBackups(params: {
  projectRoot: string;
  relativeFilePath: string;
  originalFilePath: string;
  currentContent: string;
  newContent: string;
  isNewFile: boolean;
  title?: string;
}): Promise<{ backupWarning: string | null }> {
  let backupWarning: string | null = null;

  if (!params.isNewFile) {
    try {
      await ensureBaselineBackup({
        projectRoot: params.projectRoot,
        relativeFilePath: params.relativeFilePath,
        originalFilePath: params.originalFilePath,
        baselineContent: params.currentContent,
      });
    } catch (_e) {
      backupWarning =
        'Failed to create baseline backup (pre-first-edit). File was edited without a backup.';
    }
  }

  try {
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      const tsKey = formatTimestampKey(new Date());
      try {
        await writeBackupPair({
          projectRoot: params.projectRoot,
          relativeFilePath: params.relativeFilePath,
          originalFilePath: params.originalFilePath,
          timestampKey: tsKey,
          kind: 'revision',
          title: params.title,
          content: params.newContent,
        });
        break;
      } catch (e: unknown) {
        const code =
          typeof e === 'object' && e !== null && 'code' in e
            ? (e as { code?: unknown }).code
            : undefined;

        if (code === 'EEXIST' && attempt < maxAttempts) {
          // Retry with a regenerated timestamp key.
          continue;
        }
        throw e;
      }
    }
  } catch (_e) {
    backupWarning =
      backupWarning ??
      'Failed to create backup revision. File was edited without a backup.';
  }

  return { backupWarning };
}
