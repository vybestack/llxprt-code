/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { heapStats } from 'bun:jsc';

const [, , outputPath, mode = 'text'] = process.argv;
if (
  outputPath === undefined ||
  process.env['LLXPRT_MEMORY_PORT'] === undefined
) {
  throw new Error(
    'Usage: LLXPRT_MEMORY_PORT=PORT bun issue-2852-memory-target.ts OUTPUT [text|media]',
  );
}
if (mode !== 'text' && mode !== 'media') {
  throw new Error(`Mode must be 'text' or 'media', got: ${mode}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
rmSync(outputPath, { force: true });
const retained: Array<string | Uint8Array> = [];

async function awaitSample(name: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${process.env['LLXPRT_MEMORY_PORT']}/checkpoint/${name}`,
    {
      method: 'POST',
    },
  );
  if (!response.ok) {
    throw new Error(`Checkpoint ${name} failed: ${response.status}`);
  }
}

function checkpoint(name: 'baseline' | 'pre-gc' | 'post-gc'): void {
  const record = {
    name,
    pid: process.pid,
    processMemory: process.memoryUsage(),
    jsc: heapStats(),
    recordedAt: new Date().toISOString(),
  };
  appendFileSync(outputPath, `${JSON.stringify(record)}\n`);
}

function runWorkload(): void {
  if (mode === 'media') {
    for (let index = 0; index < 32; index += 1) {
      retained.push(new Uint8Array(1024 * 1024));
    }
    return;
  }
  for (let index = 0; index < 200_000; index += 1) {
    retained.push(`stream-delta-${index.toString().padStart(6, '0')}`);
  }
}

checkpoint('baseline');
await awaitSample('baseline');
runWorkload();
checkpoint('pre-gc');
await awaitSample('pre-gc');
retained.length = 0;
Bun.gc(true);
checkpoint('post-gc');
await awaitSample('post-gc');
