/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import {
  withDetachedFixture,
  detachedRow,
  detachedRows,
  detachedDigest,
  detachedDurableDigest,
  type DetachedFixture,
} from '../../packages/core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import {
  conversationFor,
  forbidArrayRollback,
  gate,
} from '../../packages/agents/src/core/conversation-array-test-helpers.js';
import type { ConversationManager } from '../../packages/agents/src/core/ConversationManager.js';

async function settled(): Promise<{ heap: number; external: number }> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}

function submit(
  fixture: DetachedFixture,
  conversation: ConversationManager,
  size: number,
  trap: boolean,
): {
  operation: Promise<unknown>;
  caller: RowOwnership;
  held: { rows: IContent[] };
  pre: ReturnType<RowOwnership['snapshot']>;
} {
  const caller = new RowOwnership();
  const held = {
    rows: Array.from({ length: size }, (_, index) => detachedRow(index)),
  };
  for (const row of held.rows) {
    fixture.owners.retain(row);
    caller.retain(row);
  }
  const operation = rejectedValue(conversation.setHistory(held.rows));
  const pre = fixture.owners.snapshot();
  if (!trap) {
    for (const row of held.rows) {
      fixture.owners.release(row);
      caller.release(row);
    }
    held.rows = [];
  }
  return { operation, caller, held, pre };
}

async function probe(size: number, trap: boolean): Promise<void> {
  await withDetachedFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    for await (const row of detachedRows(size))
      await recorder.commit('content', { content: row });
    await history.recalculateTotalTokens();
    const conversation = conversationFor(history);
    forbidArrayRollback(history);
    const ready = gate();
    const release = gate();
    const failure = new Error('conversation suspended finalization');
    history.registerMediaOwner(
      mediaParticipant(() => ({
        publish: () => undefined,
        finalize: async () => {
          ready.resolve();
          await release.promise;
          throw failure;
        },
        rollback: () => undefined,
      })),
    );
    const before = await settled();
    const active = submit(fixture, conversation, size, trap);
    await Promise.race([
      ready.promise,
      active.operation.then((error) => {
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
          preRows: active.pre.liveRows,
          preBytes: active.pre.liveSerializedBytes,
          heldRows: stats.liveRows,
          heldBytes: stats.liveSerializedBytes,
          callerRows: active.caller.snapshot().liveRows,
          callerBytes: active.caller.snapshot().liveSerializedBytes,
          storedRows: stats.liveRows - active.caller.snapshot().liveRows,
          returnedRows: 0,
        }) + '\n',
      );
    } finally {
      release.resolve();
      await active.operation;
      for (const row of active.held.rows) {
        owners.release(row);
        active.caller.release(row);
      }
      active.held.rows = [];
    }
    if ((await active.operation) !== failure)
      throw new Error('Lost caller rollback failure');
    const expected = await detachedDigest(detachedRows(size));
    if (
      JSON.stringify(await detachedDurableDigest(recorder)) !==
      JSON.stringify(expected)
    )
      throw new Error('Durable rollback divergence');
    if (owners.snapshot().liveRows !== 0)
      throw new Error('Leaked caller owners');
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
await withDetachedFixture(async ({ history }) => {
  await history.detachedValues.replace(detachedRows(32));
  await conversationFor(history).setHistory(
    Array.from({ length: 32 }, (_, index) => detachedRow(index)),
  );
});
await probe(size, process.argv[3] === 'trap');
