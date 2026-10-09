/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { existsSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { buildChronologyTrace } from './historyChronology.js';
import { sanitizeProviderHistoryForSerialization } from './historyCloneUtils.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';

export type Query = 'clone' | 'trace';
export function journalShapeRow(index: number, payloadBytes: number): IContent {
  const row = suffixRow(index, payloadBytes);
  return {
    ...row,
    blocks: [
      ...row.blocks,
      {
        type: 'tool_call',
        id: `call-${index}`,
        name: 'inspect',
        parameters: { index, nested: [index + 1] },
        providerMetadata: { detail: 'high' },
      },
      {
        type: 'tool_response',
        callId: `call-${index}`,
        toolName: 'inspect',
        result: { index, nested: [index + 2] },
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
        caption: `media-${index}`,
      },
    ],
  };
}

export type Exit = 'return' | 'throw' | 'break' | 'consumer-throw';
export function queryStream(
  service: HistoryService,
  query: Query,
): AsyncGenerator<object, void, unknown> {
  return query === 'clone' ? service.clone() : service.getChronologyTrace();
}
export function scratchDirectories(): string[] {
  return readdirSync(tmpdir())
    .filter((name) =>
      /llxprt-(row-directory|resolver|density-index)-/.test(name),
    )
    .map((name) => join(tmpdir(), name));
}
export function mixedRow(): IContent {
  const shared = { nested: ['input'] };
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'private text' },
      {
        type: 'tool_call',
        id: 'call',
        name: 'inspect',
        parameters: { first: shared, second: shared },
        providerMetadata: { nested: ['call'] },
      },
      {
        type: 'tool_response',
        callId: 'call',
        toolName: 'inspect',
        result: { secret: 'private result' },
        providerMetadata: { nested: ['response'] },
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
        providerMetadata: { observedAt: new Date('2026-09-29T00:00:00Z') },
      },
    ],
    metadata: {
      isSummary: true,
      chronologyReplaced: { fromSeq: 1, toSeq: 4, itemCount: 4 },
    },
  };
}
async function consumeExit(
  stream: AsyncGenerator<object, void, unknown>,
  exit: Exit,
): Promise<void> {
  if (exit === 'return') await stream.return();
  else if (exit === 'throw') await stream.throw(new Error('iterator failed'));
  else {
    for await (const row of stream) {
      void row;
      if (exit === 'consumer-throw') throw new Error('consumer failed');
      break;
    }
  }
}
export async function exitMeasurement(
  query: Query,
  exit: Exit,
): Promise<object> {
  return withCoreSuffixFixture(512, async (service, ownership) => {
    const before = scratchDirectories();
    const stream = queryStream(service, query);
    const first = await stream.next();
    const heldRows = ownership.snapshot().liveRows;
    const created = scratchDirectories().filter(
      (directory) => !before.includes(directory),
    );
    try {
      const failure = await exitFailure(stream, exit);
      return {
        done: first.done,
        heldRows,
        scratchOpened: created.length > 0,
        liveRows: ownership.snapshot().liveRows,
        scratchClosed: created.every((directory) => !existsSync(directory)),
        failure,
      };
    } finally {
      await stream.return();
    }
  });
}
async function exitFailure(
  stream: AsyncGenerator<object, void, unknown>,
  exit: Exit,
): Promise<string | undefined> {
  try {
    await consumeExit(stream, exit);
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}
export async function traversalMeasurement(
  size: number,
  query: Query,
  eager: boolean,
): Promise<{
  count: number;
  decodedPeak: number;
  ownerPeak: number;
  liveRows: number;
  within: boolean;
  parity: boolean;
}> {
  return withCoreSuffixFixture(
    size,
    async (service, ownership, counters) => {
      const retained: object[] = [];
      let count = 0;
      let parity = true;
      try {
        for await (const output of queryStream(service, query)) {
          ownership.retain(output);
          const source = journalShapeRow(count, 2048);
          const expected =
            query === 'clone'
              ? sanitizeProviderHistoryForSerialization([source])[0]
              : buildChronologyTrace([source])[0];
          parity = isDeepStrictEqual(output, expected) && parity;
          count++;
          if (eager) retained.push(output);
          else ownership.release(output);
        }
      } finally {
        for (const output of retained) ownership.release(output);
      }
      return {
        count,
        parity,
        decodedPeak: counters.snapshot().peakDecodedRows,
        ownerPeak: ownership.snapshot().peakRows,
        liveRows: ownership.snapshot().liveRows,
        within: ownership.within({
          rows: 440,
          serializedBytes: 8 * 1024 * 1024,
        }),
      };
    },
    2048,
    journalShapeRow,
  );
}
