/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BigIntStats } from 'node:fs';
import { lstat, type FileHandle } from 'node:fs/promises';
import { isNodeError } from './errors.js';

/**
 * Windows has no O_NOFOLLOW, and `open(path, 'wx')` there creates the target
 * of a dangling symlink instead of failing. Callers that must not follow links
 * therefore inspect the path entry itself (lstat reports links and junctions
 * on every platform) before opening, and verify afterwards that the opened
 * handle is that same entry.
 */
export async function lstatPathEntry(
  path: string,
): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * True when `path` is currently a non-link entry whose device and file id match
 * the open handle. Bigint stats keep 64-bit Windows file ids exact.
 */
export async function handleIsPathEntry(
  handle: FileHandle,
  path: string,
): Promise<boolean> {
  const [opened, entry] = await Promise.all([
    handle.stat({ bigint: true }),
    lstatPathEntry(path),
  ]);
  return (
    entry !== undefined &&
    !entry.isSymbolicLink() &&
    entry.dev === opened.dev &&
    entry.ino === opened.ino
  );
}
