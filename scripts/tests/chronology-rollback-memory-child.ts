/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  exactTokenizer,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { retainHistoryForMemoryTrap } from './retaining-history-test-helper.js';

async function settled(): Promise<{ heap: number; external: number }> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}

const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
const trap = process.argv[3] === 'trap';
if (!Number.isSafeInteger(size) || size < 1)
  throw new Error('Expected positive row count');
await withSuffixFixture(32, async (service) => {
  service.registerMediaOwner(
    mediaParticipant(() => ({
      publish: () => undefined,
      rollback: () => undefined,
    })),
  );
  service.setTokenizerFactory(exactTokenizer());
  await service.transformAll(async (source, sink) => {
    for await (const { row } of source.streamRows()) sink.appendDetached(row);
  });
});
await withSuffixFixture(
  size,
  async (service) => {
    let reached: (() => void) | undefined;
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldRows = 0;
    let heldBytes = 0;
    service.registerMediaOwner(
      mediaParticipant((input) => {
        heldRows = input.previous.length;
        for (const row of input.previous)
          heldBytes += Buffer.byteLength(JSON.stringify(row));
        return { publish: () => undefined, rollback: () => undefined };
      }),
    );
    service.setTokenizerFactory(exactTokenizer());
    const before = await settled();
    const retained: readonly IContent[] = trap
      ? retainHistoryForMemoryTrap(service)
      : [];
    const failure = new Error('rollback probe publication failure');
    const operation = rejectedValue(
      service.transformAll(
        async (source, sink) => {
          for await (const { row } of source.streamRows())
            sink.appendDetached(row);
        },
        undefined,
        {
          afterPublication: async (): Promise<void> => {
            reached?.();
            await gate;
            throw failure;
          },
        },
      ),
    );
    await ready;
    try {
      const held = await settled();
      process.stdout.write(
        JSON.stringify({
          size,
          trap,
          heap: held.heap - before.heap,
          external: held.external - before.external,
          heldRows,
          heldBytes,
          trapRows: retained.length,
        }) + '\n',
      );
    } finally {
      release?.();
      await operation;
    }
    if ((await operation) !== failure)
      throw new Error('Rollback probe lost its primary failure');
  },
  2048,
  (index, bytes) => ({
    ...rollbackRow(index, bytes),
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  }),
);
