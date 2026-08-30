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
 *
 * The `media` mode deliberately does NOT go through the buffer. It exercises
 * the separate question the issue raises about image payloads: whether
 * re-materialising a data URI per retained image drives native
 * IOAccelerator/IOSurface growth. Text and media are different code paths and
 * are measured separately.
 */

import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { heapStats } from 'bun:jsc';
import { EmojiFilter } from '../packages/core/src/filters/EmojiFilter.js';
import { PendingResponseBuffer } from '../packages/cli/src/ui/hooks/agentStream/pendingResponseBuffer.js';
import { StreamOutputAccumulator } from '../packages/agents/src/core/streamOutputAccumulator.js';
import { createInkWorkload } from './issue-2852-memory-ink.ts';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const [, , outputPath, mode = 'text', turnArg = '4'] = process.argv;
if (
  outputPath === undefined ||
  process.env['LLXPRT_MEMORY_PORT'] === undefined
) {
  throw new Error(
    'Usage: LLXPRT_MEMORY_PORT=PORT bun issue-2852-memory-target.ts OUTPUT [text|media|reasoning|ink] [turns]',
  );
}
if (
  mode !== 'text' &&
  mode !== 'media' &&
  mode !== 'reasoning' &&
  mode !== 'ink'
) {
  throw new Error(
    `Mode must be 'text', 'media', 'reasoning', or 'ink', got: ${mode}`,
  );
}
const port = process.env['LLXPRT_MEMORY_PORT'];
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
  throw new Error(`LLXPRT_MEMORY_PORT must be a TCP port, got: ${port}`);
}
const turns = Number.parseInt(turnArg, 10);
if (!Number.isInteger(turns) || turns < 1) {
  throw new Error(`Turns must be a positive integer, got: ${turnArg}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
rmSync(outputPath, { force: true });

/** Time the runner is given to capture OS metrics before we give up. */
const CHECKPOINT_TIMEOUT_MS = 120_000;

async function awaitSample(name: string): Promise<void> {
  // Without a timeout a runner that dies mid-capture would leave the target
  // hanging forever, holding its measured memory.
  const response = await fetch(`http://127.0.0.1:${port}/checkpoint/${name}`, {
    method: 'POST',
    signal: AbortSignal.timeout(CHECKPOINT_TIMEOUT_MS),
  });
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

function reasoningChunk(
  blocks: ModelStreamChunk['content']['blocks'],
): ModelStreamChunk {
  return { content: { speaker: 'ai', blocks } };
}

function reasoningThinking(partial: {
  thought: string;
  streamId: string;
  streamStatus: 'delta' | 'complete';
  signature?: string;
}): ThinkingBlock {
  return { type: 'thinking', sourceField: 'thinking', ...partial };
}

const REASONING_STEP_PREFIX = 'step '.repeat(20);

/**
 * Deterministic final reasoning string per turn: roughly 30 KB so 200 deltas of
 * full-so-far prefixes accumulate several MB of cumulative materialized text
 * per turn, reproducing the original duplicated-string pressure.
 */
const REASONING_FINAL_LENGTH = 30_000;

function buildFinalReasoningThought(turn: number): string {
  const filler = REASONING_STEP_PREFIX.repeat(
    Math.ceil(REASONING_FINAL_LENGTH / REASONING_STEP_PREFIX.length),
  );
  return `turn ${turn} final complete reasoning
${filler}`.slice(0, REASONING_FINAL_LENGTH);
}

function materializeReasoningPrefix(finalThought: string, end: number): string {
  return Buffer.from(finalThought.slice(0, end), 'utf8').toString('utf8');
}

/**
 * Drives the real StreamOutputAccumulator with full-so-far thinking deltas the
 * way Anthropic streams them: each delta carries the complete accumulated
 * thought-so-far. Each prefix is copied through a Buffer so the benchmark
 * creates distinct string backing stores instead of engine-dependent substring
 * views. The terminal complete block carries the exact full final string plus
 * signature. The accumulator must collapse each span to one block with the
 * final complete text — the unbounded-growth path this exercises.
 */
function runReasoningTurn(turn: number): number {
  const streamId = `reasoning-span-${turn}`;
  const accumulator = new StreamOutputAccumulator();
  const finalThought = buildFinalReasoningThought(turn);
  const signature = `sig-${turn}`;
  const deltaCount = 200;
  const stepSize = Math.ceil(finalThought.length / deltaCount);
  for (let i = 1; i <= deltaCount; i++) {
    accumulator.add(
      reasoningChunk([
        reasoningThinking({
          thought: materializeReasoningPrefix(finalThought, stepSize * i),
          streamId,
          streamStatus: 'delta',
        }),
      ]),
    );
  }
  accumulator.add(
    reasoningChunk([
      reasoningThinking({
        thought: finalThought,
        streamId,
        streamStatus: 'complete',
        signature,
      }),
    ]),
  );
  const output = accumulator.materialize();
  const thinkingBlocks = output.content.blocks.filter(
    (b): b is ThinkingBlock => b.type === 'thinking',
  );
  if (thinkingBlocks.length !== 1) {
    throw new Error(
      `Reasoning turn ${turn} produced ${thinkingBlocks.length} thinking blocks, expected 1`,
    );
  }
  if (thinkingBlocks[0].thought !== finalThought) {
    throw new Error(
      `Reasoning turn ${turn} thought mismatch: got ${thinkingBlocks[0].thought.length} bytes, expected ${finalThought.length}`,
    );
  }
  if (thinkingBlocks[0].streamStatus !== 'complete') {
    throw new Error(
      `Reasoning turn ${turn} streamStatus is ${thinkingBlocks[0].streamStatus}, expected complete`,
    );
  }
  if (thinkingBlocks[0].streamId !== streamId) {
    throw new Error(
      `Reasoning turn ${turn} streamId is ${thinkingBlocks[0].streamId}, expected ${streamId}`,
    );
  }
  if (thinkingBlocks[0].signature !== signature) {
    throw new Error(
      `Reasoning turn ${turn} signature is ${thinkingBlocks[0].signature}, expected ${signature}`,
    );
  }
  return thinkingBlocks[0].thought.length;
}

const deltas = toDeltas(buildResponse());

/**
 * Frames per turn for `ink`. Large enough that the allocator high-water settles
 * inside the first turn, so later turns measure accumulation rather than
 * warm-up.
 *
 * Do not trim this for speed without re-measuring. On the pinned fork over five
 * turns, 20 frames a turn leaves the post-GC JSC heap climbing 12.5% across the
 * settled turns, because the first turn has not finished filling Ink's caches
 * and the verdict reports that warm-up as a leak. At 1500 the heap and
 * `external` settle inside 0.1%. At 3000 they hold between 0.02% and 0.09%
 * across six runs.
 */
const INK_FRAMES_PER_TURN = 3_000;

// Mounted once and reused across turns; see createInkWorkload.
const inkWorkload = mode === 'ink' ? createInkWorkload() : undefined;

checkpoint('baseline');
await awaitSample('baseline');

for (let turn = 1; turn <= turns; turn += 1) {
  if (mode === 'media') {
    runMediaTurn();
  } else if (mode === 'reasoning') {
    runReasoningTurn(turn);
  } else if (mode === 'ink') {
    inkWorkload?.renderFrames(INK_FRAMES_PER_TURN);
  } else {
    runTurn(deltas);
  }
  checkpoint(`turn-${turn}-pre-gc`);
  await awaitSample(`turn-${turn}-pre-gc`);
  Bun.gc(true);
  checkpoint(`turn-${turn}-post-gc`);
  await awaitSample(`turn-${turn}-post-gc`);
}

inkWorkload?.dispose();
