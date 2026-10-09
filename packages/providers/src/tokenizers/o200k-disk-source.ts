/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { countPiece } from './o200k-disk-bpe.js';
import {
  checkpoint,
  DiskCharacters,
  normalizeSource,
} from './o200k-disk-io.js';
import { nextPiece } from './o200k-disk-regex.js';

export interface O200kDiskSource {
  readonly path: string;
  readonly encoding?: 'utf8' | 'utf16le';
}

export interface O200kDiskCountOptions {
  readonly workspaceDirectory: string;
  readonly signal?: AbortSignal;
}

async function countNormalized(
  source: string,
  directory: string,
  signal?: AbortSignal,
): Promise<number> {
  const reader = new DiskCharacters(source);
  try {
    let position = 0;
    let count = 0;
    let pieces = 0;
    while (reader.at(position)) {
      const end = await nextPiece(reader, position, signal);
      count += await countPiece(source, directory, position, end, signal);
      position = end;
      if (++pieces % 256 === 0) await checkpoint(signal);
    }
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(count))
      throw new RangeError('Token count exceeds JavaScript integer precision');
    return count;
  } finally {
    reader.close();
  }
}

export async function countO200kBaseTokensFromDiskSource(
  source: O200kDiskSource,
  options: O200kDiskCountOptions,
): Promise<number> {
  options.signal?.throwIfAborted();
  const directory = await mkdtemp(
    join(options.workspaceDirectory, 'o200k-count-'),
  );
  try {
    const normalized = join(directory, 'utf8');
    await normalizeSource(
      source.path,
      normalized,
      source.encoding ?? 'utf8',
      options.signal,
    );
    return await countNormalized(normalized, directory, options.signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
