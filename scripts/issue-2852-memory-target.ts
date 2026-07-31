/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic single-process workload for issue #2852.
 *
 * The point of the benchmark is to measure the real streaming pipeline, not a
 * synthetic allocation loop, so this drives the same `PendingResponseBuffer`
 * the Ink UI uses: incremental sanitisation plus incremental markdown
 * split-point scanning, one delta at a time.
 *
 * It runs several equivalent turns and takes a checkpoint after a controlled
 * full GC at the end of each, so the runner can check that the post-GC JSC heap
 * reaches a stable plateau instead of climbing turn over turn.
 */

import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { heapStats } from 'bun:jsc';
import { EmojiFilter } from '../packages/core/src/filters/EmojiFilter.js';
import { PendingResponseBuffer } from '../packages/cli/src/ui/hooks/agentStream/pendingResponseBuffer.js';

const [, , outputPath, mode = 'text', turnArg = '4'] = process.argv;
if (
  outputPath === undefined ||
  process.env['LLXPRT_MEMORY_PORT'] === undefined
) {
  throw new Error(
    'Usage: LLXPRT_MEMORY_PORT=PORT bun issue-2852-memory-target.ts OUTPUT [text|media] [turns]',
  );
}
if (mode !== 'text' && mode !== 'media') {
  throw new Error(`Mode must be 'text' or 'media', got: ${mode}`);
}
const turns = Number.parseInt(turnArg, 10);
if (!Number.isInteger(turns) || turns < 1) {
  throw new Error(`Turns must be a positive integer, got: ${turnArg}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
rmSync(outputPath, { force: true });

async function awaitSample(name: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${process.env['LLXPRT_MEMORY_PORT']}/checkpoint/${name}`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error(`Checkpoint ${name} failed: ${response.status}`);
  }
}

function checkpoint(name: string): void {
  const record = {
    name,
    pid: process.pid,
    processMemory: process.memoryUsage(),
    jsc: heapStats(),
    recordedAt: new Date().toISOString(),
  };
  appendFileSync(outputPath, `${JSON.stringify(record)}\n`);
}

/**
 * A response shaped like real assistant output: prose paragraphs followed by a
 * long fenced code block that is still open for most of the stream. The open
 * fence is the important part — it is the case where the previous
 * implementation rescanned and re-copied the whole accumulated response on
 * every delta.
 */
function buildResponse(): string {
  const prose = Array.from(
    { length: 40 },
    (_, i) =>
      `Paragraph ${i}: this explains one step of the change in a sentence or two.`,
  ).join('\n\n');
  const code = Array.from(
    { length: 4_000 },
    (_, i) => `  const value${i} = compute(${i});`,
  ).join('\n');
  return `${prose}\n\n\`\`\`ts\nexport function generated() {\n${code}\n`;
}

/** Splits into token-sized deltas the way a provider streams them. */
function toDeltas(text: string): string[] {
  const deltas: string[] = [];
  for (let index = 0; index < text.length; index += 4) {
    deltas.push(text.slice(index, index + 4));
  }
  return deltas;
}

function mediaPayload(): string {
  // Base64 of a repeating byte pattern, sized like a real screenshot.
  return Buffer.alloc(2 * 1024 * 1024, 0x7a).toString('base64');
}

function runTurn(deltas: readonly string[]): number {
  const buffer = new PendingResponseBuffer(new EmojiFilter({ mode: 'auto' }));
  let committed = 0;
  for (const delta of deltas) {
    buffer.push(delta);
    const splitPoint = buffer.getSplitPoint();
    if (splitPoint > 0 && splitPoint < buffer.stableText.length) {
      committed += splitPoint;
      buffer.consume(splitPoint);
    }
    // Materialising the display text is what the pending Ink item does on
    // every delta.
    void buffer.displayText.length;
  }
  committed += buffer.materialize().text.length;
  buffer.reset();
  return committed;
}

function runMediaTurn(): number {
  const encoded = mediaPayload();
  const blocks = Array.from({ length: 8 }, () => ({
    type: 'media' as const,
    mimeType: 'image/png',
    data: encoded,
  }));
  // Each provider request re-materialises a data URI per retained image.
  let bytes = 0;
  for (const block of blocks) {
    bytes += `data:${block.mimeType};base64,${block.data}`.length;
  }
  return bytes;
}

const deltas = toDeltas(buildResponse());
let sink = 0;

checkpoint('baseline');
await awaitSample('baseline');

for (let turn = 1; turn <= turns; turn += 1) {
  sink += mode === 'media' ? runMediaTurn() : runTurn(deltas);
  checkpoint(`turn-${turn}-pre-gc`);
  await awaitSample(`turn-${turn}-pre-gc`);
  Bun.gc(true);
  checkpoint(`turn-${turn}-post-gc`);
  await awaitSample(`turn-${turn}-post-gc`);
}

if (sink < 0) {
  throw new Error('unreachable: workload sink');
}
