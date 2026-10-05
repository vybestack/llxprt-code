/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import {
  withDetachedFixture,
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
import { gate } from '../../packages/agents/src/core/conversation-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
} from '../../packages/agents/src/core/client-array-test-helpers.js';
import { withRetainedClient } from '../../packages/agents/src/core/retained-array-test-helpers.js';
import type { AgentClientContract } from '../../packages/core/src/core/clientContract.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

async function settled(): Promise<{ heap: number; external: number }> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}
function submit(
  fixture: DetachedFixture,
  client: AgentClientContract,
  size: number,
  trap: boolean,
): {
  operation: Promise<unknown>;
  caller: RowOwnership;
  held: { rows: IContent[] };
  pre: ReturnType<RowOwnership['snapshot']>;
} {
  const caller = new RowOwnership();
  const held = { rows: clientArrayRows(size) };
  for (const row of held.rows) {
    fixture.owners.retain(row);
    caller.retain(row);
  }
  const operation = rejectedValue(
    client.storeHistoryForLaterUse(held.rows, { ownership: fixture.owners }),
  );
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
  await withDetachedFixture((fixture) =>
    withRetainedClient(fixture, async ({ client }) => {
      const { history, recorder, owners } = fixture;
      for await (const row of detachedRows(size))
        await recorder.commit('content', { content: row });
      await history.recalculateTotalTokens();
      forbidClientArrayRollback(fixture);
      const ready = gate();
      const release = gate();
      const failure = new Error('client suspended finalization');
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
      const active = submit(fixture, client, size, trap);
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
      const error = await active.operation;
      if (!(error instanceof Error) || !error.message.includes(failure.message))
        throw new Error('Lost client rollback failure');
      const expected = await detachedDigest(detachedRows(size));
      if (
        JSON.stringify(await detachedDurableDigest(recorder)) !==
        JSON.stringify(expected)
      )
        throw new Error('Client durable rollback divergence');
      if (owners.snapshot().liveRows !== 0)
        throw new Error('Leaked client owners');
    }),
  );
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
const keepAlive = setInterval(() => undefined, 1000);
try {
  await withDetachedFixture((fixture) =>
    withRetainedClient(fixture, async ({ client }) => {
      await fixture.history.detachedValues.replace(detachedRows(32));
      await client.storeHistoryForLaterUse(clientArrayRows(32));
    }),
  );
  await probe(size, process.argv[3] === 'trap');
} finally {
  clearInterval(keepAlive);
}
