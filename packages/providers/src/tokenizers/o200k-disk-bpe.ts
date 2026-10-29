/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { closeSync, openSync, readSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { diskAssets } from './o200k-disk-assets.js';
import { checkpoint, TokenFile, TokenWriter } from './o200k-disk-io.js';

function rank(left: Buffer, right: Buffer): number {
  const assets = diskAssets();
  if (left.length + right.length > assets.maxBytes) return Infinity;
  return (
    assets.ranks.get(left.toString('latin1') + right.toString('latin1')) ??
    Infinity
  );
}

async function writeSeed(
  fd: number,
  writer: TokenWriter,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<void> {
  const buffer = Buffer.alloc(65536);
  let position = start;
  while (position < end) {
    const size = readSync(
      fd,
      buffer,
      0,
      Math.min(buffer.length, end - position),
      position,
    );
    if (size === 0) throw new Error('Source changed during disk BPE');
    for (let index = 0; index < size; index++)
      writer.write(buffer.subarray(index, index + 1));
    position += size;
    await checkpoint(signal);
  }
}

async function seed(
  source: string,
  path: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<void> {
  const fd = openSync(source, 'r');
  try {
    const writer = new TokenWriter(path);
    try {
      await writeSeed(fd, writer, start, end, signal);
    } finally {
      writer.close();
    }
  } finally {
    closeSync(fd);
  }
}

async function minimum(
  path: string,
  signal?: AbortSignal,
): Promise<{ rank: number; count: number }> {
  const reader = new TokenFile(path);
  try {
    let previous = reader.next();
    let result = Infinity;
    let count = previous ? 1 : 0;
    for (let token = reader.next(); token; token = reader.next()) {
      if (!previous) throw new Error('Missing previous disk token');
      result = Math.min(result, rank(previous, token));
      previous = token;
      if (++count % 65536 === 0) await checkpoint(signal);
    }
    return { rank: result, count };
  } finally {
    reader.close();
  }
}

function interruptsOrder(
  previous: Buffer | undefined,
  merged: Buffer,
  following: Buffer | undefined,
  selected: number,
): boolean {
  if (previous && rank(previous, merged) <= selected) return true;
  return following !== undefined && rank(merged, following) <= selected;
}

async function writeMerges(
  reader: TokenFile,
  writer: TokenWriter,
  selected: number,
  single: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  let left = reader.next();
  let right = reader.next();
  let previous: Buffer | undefined;
  let mergedOnce = false;
  let work = 0;
  while (left && right) {
    if ((!single || !mergedOnce) && rank(left, right) === selected) {
      const merged = Buffer.concat([left, right]);
      const following = reader.next();
      if (!single && interruptsOrder(previous, merged, following, selected))
        return false;
      writer.write(merged);
      previous = merged;
      left = following;
      right = reader.next();
      mergedOnce = true;
    } else {
      writer.write(left);
      previous = left;
      left = right;
      right = reader.next();
    }
    if (++work % 65536 === 0) await checkpoint(signal);
  }
  if (left) writer.write(left);
  return true;
}

async function mergePass(
  input: string,
  output: string,
  selected: number,
  signal?: AbortSignal,
  single = false,
): Promise<boolean> {
  const reader = new TokenFile(input);
  try {
    const writer = new TokenWriter(output);
    try {
      return await writeMerges(reader, writer, selected, single, signal);
    } finally {
      writer.close();
    }
  } finally {
    reader.close();
  }
}

function direct(source: string, start: number, end: number): boolean {
  if (end - start > diskAssets().maxBytes) return false;
  const fd = openSync(source, 'r');
  try {
    const bytes = Buffer.alloc(end - start);
    if (readSync(fd, bytes, 0, bytes.length, start) !== bytes.length)
      throw new Error('Source changed during direct lookup');
    return diskAssets().ranks.has(bytes.toString('latin1'));
  } finally {
    closeSync(fd);
  }
}

export async function countPiece(
  source: string,
  directory: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<number> {
  if (direct(source, start, end)) return 1;
  let current = join(directory, 'tokens-a');
  let next = join(directory, 'tokens-b');
  await seed(source, current, start, end, signal);
  let selected = await minimum(current, signal);
  while (selected.rank !== Infinity) {
    if (!(await mergePass(current, next, selected.rank, signal))) {
      await mergePass(current, next, selected.rank, signal, true);
    }
    unlinkSync(current);
    [current, next] = [next, current];
    selected = await minimum(current, signal);
  }
  unlinkSync(current);
  return selected.count;
}
