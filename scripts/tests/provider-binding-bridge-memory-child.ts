/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { JournalHistoryStore } from '../../packages/core/src/services/history/journalHistoryStore.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';
import {
  bindingBridgeRows,
  bindingContentId,
  bindingFile,
} from '../../packages/core/src/services/history/provider-binding-bridge-test-helpers.js';
import { createHistoryProviderFileBindingStore } from '../../packages/core/src/services/history/provider-file-binding.js';
import {
  exactTokenizer,
  journalMediaParticipant,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

async function withBindingHistory(
  size: number,
  action: (fixture: {
    history: HistoryService;
    owners: RowOwnership;
  }) => Promise<void>,
): Promise<void> {
  const owners = new RowOwnership();
  const history = new HistoryService({ mutationOwnership: owners });
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.waitForCommit();
    const journal = history.detachedValues.host().journal;
    if (!(journal instanceof JournalHistoryStore))
      throw new Error('Binding memory fixture requires a journal store');
    await journal.replaceFrom(bindingBridgeRows(size), size);
    await history.recalculateTotalTokens();
    await history.waitForCommit();
    await action({ history, owners });
  } finally {
    await history.dispose();
  }
}

async function settled(): Promise<{ heap: number; external: number }> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}
async function probe(size: number, trap: boolean): Promise<void> {
  await withBindingHistory(size, async ({ history, owners }) => {
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
    const previous = trap ? await history.openDumpSnapshot() : undefined;
    await history.registerMediaOwner(
      journalMediaParticipant(async () => {
        if (previous !== undefined) {
          try {
            for await (const row of previous.rows()) {
              retained.push(row);
              owners.retain(row);
            }
          } finally {
            await previous.close();
          }
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
await withBindingHistory(32, async ({ history }) => {
  await createHistoryProviderFileBindingStore(history).bind(
    bindingContentId,
    bindingFile,
  );
});
await probe(size, process.argv[3] === 'trap');
