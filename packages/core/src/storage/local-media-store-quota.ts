/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dirent } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { MediaStoreError } from './local-media-store-types.js';
import {
  CONTENT_ID_PREFIX,
  DIGEST_PATTERN,
  wrapError,
} from './local-media-store-validation.js';

function validateQuotaEntry(entry: Dirent<string>): void {
  if (!DIGEST_PATTERN.test(entry.name) || !entry.isFile()) {
    throw new MediaStoreError(
      'measure spool quota',
      entry.name,
      new Error('Unexpected object-store entry'),
    );
  }
}

async function readQuotaEntriesWithinBound(
  objectDirectory: string,
  maxEntries: number,
): Promise<ReadonlyArray<Dirent<string>>> {
  const entries: Array<Dirent<string>> = [];
  try {
    const directory = await opendir(objectDirectory);
    for await (const entry of directory) {
      if (entries.length === maxEntries) {
        throw new MediaStoreError(
          'establish quota state within bound',
          undefined,
          new Error(`Object count exceeds quota scan bound ${maxEntries}`),
        );
      }
      validateQuotaEntry(entry);
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof MediaStoreError) throw error;
    throw wrapError('measure spool quota', undefined, error);
  }
  return entries;
}

async function measureStoredBytes(
  objectDirectory: string,
  maxEntries: number,
): Promise<number> {
  const entries = await readQuotaEntriesWithinBound(
    objectDirectory,
    maxEntries,
  );
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      try {
        return (await lstat(join(objectDirectory, entry.name))).size;
      } catch (error) {
        throw wrapError(
          'measure spool quota',
          `${CONTENT_ID_PREFIX}${entry.name}`,
          error,
        );
      }
    }),
  );
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!Number.isSafeInteger(total)) {
    throw new MediaStoreError(
      'measure spool quota',
      undefined,
      new Error('Stored byte usage exceeds safe integer range'),
    );
  }
  return total;
}

export async function measureStoredBytesWithinBound(
  objectDirectory: string,
  maxEntries: number,
  timeoutMs: number,
): Promise<number> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new MediaStoreError(
            'establish quota state within bound',
            undefined,
            new Error(`Quota scan exceeded ${timeoutMs}ms`),
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      measureStoredBytes(objectDirectory, maxEntries),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
