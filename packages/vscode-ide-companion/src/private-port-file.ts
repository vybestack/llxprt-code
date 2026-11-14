/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';

/**
 * Helpers for the IDE port file, which holds the auth token and lives under a
 * predictable path in the shared temp directory. Other local users must not be
 * able to read it, pre-create it, or redirect the write with a symlink.
 */

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

/**
 * Creates `dir` (non-recursively) with mode 0700 if it is missing, then checks
 * that what is there is a real directory owned by the current user. A loose
 * mode on a directory we own is tightened to 0700.
 */
export async function ensurePrivateDirectory(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { mode: 0o700 });
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'EEXIST') {
      throw err;
    }
  }

  const stats = await fs.lstat(dir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${dir} is not a directory`);
  }
  const uid = currentUid();
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(`${dir} is not owned by the current user`);
  }
  if ((stats.mode & 0o077) !== 0) {
    await fs.chmod(dir, 0o700);
  }
}

/**
 * Writes `content` to a new file that is private from the moment it exists.
 * A previous file (or symlink) at the path is removed first and the write uses
 * exclusive creation, so it can never follow a link planted at the path.
 */
export async function writePrivateFile(
  file: string,
  content: string,
): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'ENOENT') {
      throw err;
    }
  }
  await fs.writeFile(file, content, { mode: 0o600, flag: 'wx' });
}
