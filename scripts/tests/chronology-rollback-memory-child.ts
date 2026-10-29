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
import type { HistoryMediaOwner } from '../../packages/core/src/services/history/historyBatchContracts.js';

function probeParticipant(
  prepare: HistoryMediaOwner['prepareReplacement'],
): HistoryMediaOwner {
  return {
    ...mediaParticipant(prepare),
    prepareReferenceReplacement: (references) => ({
      publish: async (): Promise<void> => {
        for await (const reference of references) {
          if (reference.encoding !== 'reference')
            throw new Error('Expected an admitted media reference');
        }
      },
      rollback: () => undefined,
    }),
  };
}

async function retainRows(
  source: AsyncIterable<IContent>,
): Promise<readonly IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source) rows.push(row);
  return rows;
}

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
  await service.registerMediaOwner(
    probeParticipant(() => ({
      publish: () => undefined,
      rollback: () => undefined,
    })),
  );
  service.setTokenizerFactory(exactTokenizer());
  await service.detachedValues.transform(
    async (source, sink) => {
      for await (const row of source.streamRows()) await sink.appendValue(row);
    },
    undefined,
    { publishTokens: true },
  );
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
    await service.registerMediaOwner(
      probeParticipant((input) => {
        heldRows = input.previous.length;
        for (const row of input.previous)
          heldBytes += Buffer.byteLength(JSON.stringify(row));
        return { publish: () => undefined, rollback: () => undefined };
      }),
    );
    service.setTokenizerFactory(exactTokenizer());
    const before = await settled();
    const retained = trap ? await retainRows(service.streamRawHistory()) : [];
    let traversed = 0;
    const failure = new Error('rollback probe publication failure');
    const operation = rejectedValue(
      service.detachedValues.transform(
        async (source, sink) => {
          for await (const row of source.streamRows()) {
            traversed++;
            await sink.appendValue({
              ...row,
              blocks: [...row.blocks, { type: 'text', text: 'candidate' }],
            });
          }
        },
        undefined,
        {
          publishTokens: true,
          afterPublication: async (): Promise<void> => {
            reached?.();
            await gate;
            throw failure;
          },
        },
      ),
    );
    await Promise.race([
      ready,
      operation.then((error) => {
        throw error ?? new Error('Publication ended before the probe pause');
      }),
    ]);
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
          traversed,
          trapRows: retained.length,
        }) + '\n',
      );
    } finally {
      release?.();
      await operation;
    }
    if ((await operation) !== failure)
      throw new Error('Rollback probe lost its primary failure');
    let restored = 0;
    for await (const row of service.streamRawHistory()) {
      if (JSON.stringify(row) !== JSON.stringify(fixtureRow(restored, 2048)))
        throw new Error(`Rollback changed row ${restored}`);
      restored++;
    }
    if (restored !== size) throw new Error('Rollback changed the row count');
  },
  2048,
  fixtureRow,
);

function fixtureRow(index: number, bytes: number): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}
