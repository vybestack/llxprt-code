/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { withDetachedFixture } from '../../packages/core/src/services/history/detached-rollback-test-helpers.js';
import {
  bindingBridgeRows,
  bindingContentId,
  bindingFile,
  forbidLegacyBindingTransform,
} from '../../packages/core/src/services/history/provider-binding-bridge-test-helpers.js';
import { createHistoryProviderFileBindingStore } from '../../packages/core/src/services/history/provider-file-binding.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

async function settled(): Promise<{ heap: number; external: number }> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}
async function probe(size: number, trap: boolean): Promise<void> {
  await withDetachedFixture(async ({ history, recorder, owners }) => {
    for await (const row of bindingBridgeRows(size))
      await recorder.commit('content', { content: row });
    await history.recalculateTotalTokens();
    const before = await settled();
    const retained: IContent[] = [];
    let reached = (): void => {};
    let release = (): void => {};
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error('binding suspended finalization');
    history.registerMediaOwner(
      mediaParticipant(({ previous }) => {
        if (trap)
          for (const row of previous) {
            retained.push(row);
            owners.retain(row);
          }
        return {
          publish: () => undefined,
          finalize: async (): Promise<void> => {
            reached();
            await gate;
            throw failure;
          },
          rollback: () => {
            for (const row of retained) owners.release(row);
            retained.length = 0;
          },
        };
      }),
    );
    forbidLegacyBindingTransform(history);
    const operation = rejectedValue(
      createHistoryProviderFileBindingStore(history).bind(
        bindingContentId,
        bindingFile,
      ),
    );
    await Promise.race([
      ready,
      operation.then((error) => {
        throw error;
      }),
    ]);
    try {
      const held = await settled();
      const stats = owners.snapshot();
      process.stdout.write(
        JSON.stringify({
          size,
          trap,
          heap: held.heap - before.heap,
          external: held.external - before.external,
          heldRows: stats.liveRows,
          heldBytes: stats.liveSerializedBytes,
          trapRows: retained.length,
        }) + '\n',
      );
    } finally {
      release();
      await operation;
    }
    if ((await operation) !== failure)
      throw new Error('Lost binding rollback failure');
    if (owners.snapshot().liveRows !== 0)
      throw new Error('Leaked binding owners');
  });
}
const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
if (!Number.isSafeInteger(size) || size < 1)
  throw new Error('Expected positive row count');
await withDetachedFixture(async ({ history, recorder }) => {
  for await (const row of bindingBridgeRows(32))
    await recorder.commit('content', { content: row });
  await createHistoryProviderFileBindingStore(history).bind(
    bindingContentId,
    bindingFile,
  );
});
await probe(size, process.argv[3] === 'trap');
