/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, stat, watch, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalMediaStore } from './local-media-store.js';

function requiredArgument(index: number, name: string): string {
  const value = process.argv[index];
  if (value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}

function parseBytes(value: string): Uint8Array {
  const tokens = value.split(',');
  if (tokens.some((token) => !/^[0-9]+$/.test(token))) {
    throw new Error('Invalid bytes');
  }
  const values = tokens.map((token) => Number(token));
  if (
    values.some(
      (entry) => !Number.isSafeInteger(entry) || entry < 0 || entry > 255,
    )
  ) {
    throw new Error('Invalid bytes');
  }
  return new Uint8Array(values);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

async function waitForPath(path: string): Promise<void> {
  if (await pathExists(path)) return;
  const controller = new AbortController();
  const events = watch(dirname(path), { signal: controller.signal });
  try {
    if (await pathExists(path)) return;
    for await (const _event of events) {
      if (await pathExists(path)) return;
    }
    throw new Error(`Filesystem watch ended before ${path} appeared`);
  } finally {
    controller.abort();
  }
}

async function writeCrashedLock(rootDirectory: string): Promise<void> {
  const lockDirectory = join(rootDirectory, 'locks');
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(lockDirectory, 'store.lock'),
    JSON.stringify({
      version: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      createdAt: Date.now(),
    }),
    { flag: 'wx', mode: 0o600 },
  );
}

function createStore(
  mode: string,
  rootDirectory: string,
  quotaBytes: number,
): LocalMediaStore {
  const readyPath =
    mode === 'hold-publish' ? requiredArgument(6, 'ready path') : undefined;
  const releasePath =
    mode === 'hold-publish' ? requiredArgument(7, 'release path') : undefined;
  return new LocalMediaStore({
    rootDirectory,
    quotaBytes,
    lockTimeoutMs: 2_000,
    staleLockMs: 30,
    reservationLeaseMs: 30,
    ...(readyPath === undefined || releasePath === undefined
      ? {}
      : {
          fileOperations: {
            link: async (sourcePath, destinationPath): Promise<void> => {
              const released = waitForPath(releasePath);
              await writeFile(readyPath, 'ready', { flag: 'wx' });
              await released;
              await link(sourcePath, destinationPath);
            },
          },
        }),
  });
}

function writeReference(reference: unknown): void {
  process.stdout.write(`${JSON.stringify(reference)}\n`);
}

async function main(): Promise<void> {
  const mode = requiredArgument(2, 'mode');
  const rootDirectory = requiredArgument(3, 'root directory');
  const quotaBytes = parsePositiveInteger(
    requiredArgument(4, 'quota'),
    'quota',
  );
  const bytes = parseBytes(requiredArgument(5, 'bytes'));
  if (mode === 'lock-crash') {
    await writeCrashedLock(rootDirectory);
    return;
  }
  const store = createStore(mode, rootDirectory, quotaBytes);
  const reference = await store.admit({
    bytes,
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  if (mode === 'admit' || mode === 'hold-publish') {
    const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (reference.contentId !== expected) {
      throw new Error('Child admission returned the wrong content identity');
    }
    writeReference(reference);
    return;
  }
  await store.reserve(reference, `child:${process.pid}`);
  if (mode === 'reserve-crash') {
    writeReference(reference);
    return;
  }
  if (mode !== 'reserve-live') throw new Error(`Unknown mode ${mode}`);
  const readyPath = requiredArgument(6, 'ready path');
  await writeFile(readyPath, JSON.stringify(reference), { flag: 'wx' });
  await waitForPath(`${readyPath}.release`);
}

await main();
