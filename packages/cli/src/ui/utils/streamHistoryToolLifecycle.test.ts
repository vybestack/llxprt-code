/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { RowOwnership } from '../../../../core/src/recording/rowOwnership.js';
import { streamHistoryItems } from './streamHistoryItems.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';
import type { HistoryItem } from '../types.js';

let directory: string;

const ai: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'inspecting' },
    { type: 'tool_call', id: 'a', name: 'read_file', parameters: {} },
  ],
};

const response: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'a',
      toolName: 'read_file',
      result: 'x'.repeat(100000),
    },
  ],
};

describe('tool response projection lifecycle', () => {
  beforeEach(async () => {
    directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/toolpeak-lifecycle-'),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'preserves replay retention, mixed text order and duplicate-call resolution',
    verifyPreservesReplayRetentionMixedTextOrderAndDuplicateCallResolution,
  );

  it(
    'keeps the disk group under backpressure and removes it on return',
    verifyKeepsTheDiskGroupUnderBackpressureAndRemovesItOnReturn,
  );

  it('cleans up on upstream error', verifyCleansUpOnUpstreamError);

  it(
    'cancels a pending upstream fetch before publishing and releases its group',
    verifyCancelsAPendingUpstreamFetchBeforePublishingAndReleasesItsGroup,
  );

  it(
    'rejects a consumer retaining projected groups after generator advance',
    verifyRejectsAConsumerRetainingProjectedGroupsAfterGeneratorAdvance,
  );
});

async function verifyPreservesReplayRetentionMixedTextOrderAndDuplicateCallResolution(): Promise<void> {
  const source = [
    ai,
    response,
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'next' }],
    } satisfies IContent,
  ];
  const actual: HistoryItem[] = [];
  for await (const item of streamHistoryItems(source, 'allowed', undefined, {
    temporaryRoot: directory,
  }))
    actual.push(item);
  expect(actual).toStrictEqual(iContentToHistoryItems(source, 'allowed'));
  const group = actual[1];
  if (group.type !== 'tool_group') throw new Error('Missing group');
  expect(group.tools[0].retention?.capped).toBe(true);
  expect(
    Buffer.byteLength(String(group.tools[0].resultDisplay)),
  ).toBeLessThanOrEqual(65536);
  expect(await readdir(directory)).toStrictEqual([]);
}

async function verifyKeepsTheDiskGroupUnderBackpressureAndRemovesItOnReturn(): Promise<void> {
  const ownership = new RowOwnership();
  const iterator = streamHistoryItems([ai, response], 'allowed', ownership, {
    temporaryRoot: directory,
  })[Symbol.asyncIterator]();
  await iterator.next();
  expect((await readdir(directory)).length).toBe(1);
  expect(ownership.snapshot().liveRows).toBeGreaterThan(0);
  await iterator.return?.();
  expect(ownership.snapshot().liveRows).toBe(0);
  expect(await readdir(directory)).toStrictEqual([]);
}

async function verifyCleansUpOnUpstreamError(): Promise<void> {
  const ownership = new RowOwnership();
  async function* rows(): AsyncIterable<IContent> {
    yield ai;
    yield response;
    throw new Error('fetch failed');
  }
  const iterator = streamHistoryItems(rows(), undefined, ownership, {
    temporaryRoot: directory,
  })[Symbol.asyncIterator]();
  await expect(iterator.next()).rejects.toThrow('fetch failed');
  expect(ownership.snapshot().liveRows).toBe(0);
  expect(await readdir(directory)).toStrictEqual([]);
}

async function verifyCancelsAPendingUpstreamFetchBeforePublishingAndReleasesItsGroup(): Promise<void> {
  const ownership = new RowOwnership();
  const controller = new AbortController();
  let fetched: (() => void) | undefined;
  let finish: (() => void) | undefined;
  const fetching = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let upstreamClosed = false;
  async function* rows(): AsyncIterable<IContent> {
    try {
      yield ai;
      yield response;
      fetched?.();
      await pending;
      yield response;
    } finally {
      upstreamClosed = true;
    }
  }
  const iterator = streamHistoryItems(rows(), undefined, ownership, {
    temporaryRoot: directory,
    signal: controller.signal,
  })[Symbol.asyncIterator]();
  const result = iterator.next();
  await fetching;
  controller.abort(new Error('fetch cancelled'));
  finish?.();
  await expect(result).rejects.toThrow('fetch cancelled');
  expect(upstreamClosed).toBe(true);
  expect(ownership.snapshot().liveRows).toBe(0);
  expect(await readdir(directory)).toStrictEqual([]);
}

async function verifyRejectsAConsumerRetainingProjectedGroupsAfterGeneratorAdvance(): Promise<void> {
  const ownership = new RowOwnership();
  const retained: HistoryItem[] = [];
  async function* rows(): AsyncIterable<IContent> {
    for (let index = 0; index < 512; index += 1) {
      yield { ...ai, blocks: ai.blocks.slice(1) };
      yield response;
    }
  }
  try {
    for await (const item of streamHistoryItems(rows(), undefined, ownership, {
      temporaryRoot: directory,
    })) {
      ownership.retain(item);
      retained.push(item);
    }
    expect(ownership.snapshot().liveRows).toBe(512);
    expect(
      ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
    ).toBe(false);
    await writeFile(
      'tmp/verify854/p05d/toolpeak-negative.json',
      JSON.stringify(ownership.snapshot(), null, 2),
    );
    expect(await readdir(directory)).toStrictEqual([]);
  } finally {
    for (const item of retained) ownership.release(item);
  }
  expect(ownership.snapshot().liveRows).toBe(0);
}
