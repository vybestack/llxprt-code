/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import { internalConfig } from './helpers/agentHarness.js';
import {
  carryBounds,
  expectedDigest,
  historyDigest,
  recordCarry,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

for (const size of [512, 8192]) {
  describe(`AgentImpl carried startup at ${size}`, () => {
    it('starts the rebound chat through detached admission without reading an array', async () => {
      await withAgentCarry(
        size,
        async (agent, replacement, previous, input) => {
          await agent.setModel('carried-model');
          const next = replacement();
          expect(internalConfig(agent).getAgentClient()).toBe(next);
          expect(next).not.toBe(previous);
          expect(next.hasChatInitialized()).toBe(true);
          expect(next.admissions).toBe(1);
          expect(next.visited).toBe(size);
          expect(await historyDigest(agent.streamHistory())).toStrictEqual(
            expectedDigest(size),
          );
          expect(next.owners.snapshot().liveRows).toBe(0);
          expect(input.snapshot().liveRows).toBe(0);
          expect(next.owners.within(carryBounds)).toBe(true);
          expect(input.within(carryBounds)).toBe(true);
          recordCarry({
            size,
            input: input.snapshot(),
            admittedAndOutput: next.owners.snapshot(),
          });
        },
      );
    }, 180000);

    it('charges a paused source and a paused returned output while preserving snapshots', async () => {
      await withAgentCarry(
        size,
        async (agent, replacement) => {
          const failure = agent.setModel('paused-model');
          await replacement.ready;
          const next = replacement();
          try {
            await Promise.race([next.entered.promise, failure]);
            const beforePause = next.visited;
            expect(next.owners.snapshot().liveRows).toBeGreaterThan(0);
            await delay(10);
            expect({ before: beforePause, after: next.visited }).toStrictEqual({
              before: 1,
              after: 1,
            });
            next.proceed.open();
            await failure;
            const cursor = agent.streamHistory();
            const first = await cursor.next();
            if (first.done === true) throw new Error('Missing carried row');
            next.owners.retain(first.value);
            try {
              const decoded = next.counters.snapshot().rowsDecoded;
              await delay(10);
              expect(next.counters.snapshot().rowsDecoded - decoded).toBe(0);
              expect(next.owners.snapshot().liveRows).toBe(1);
              await next.setHistoryFromSource((async function* () {})());
              expect(
                (await cursor.next()).value?.metadata?.chronology?.seq,
              ).toBe(2);
              expect((await agent.streamHistory().next()).done).toBe(true);
              recordCarry({ size, pausedOutput: next.owners.snapshot() });
            } finally {
              await cursor.return();
              next.owners.release(first.value);
            }
            expect(next.owners.snapshot().liveRows).toBe(0);
            expect(next.owners.within(carryBounds)).toBe(true);
          } finally {
            next.proceed.open();
            await failure;
          }
        },
        2048,
        (client) => {
          client.pause = true;
        },
      );
    }, 180000);
  });
}

describe('oversized AgentImpl carried history', () => {
  it('accepts a valid 9 MiB carried row without applying the aggregate limit to one row', async () => {
    const bytes = 9 * 1024 * 1024;
    await withAgentCarry(
      1,
      async (agent, replacement) => {
        await agent.setModel('large-carried-model');
        expect(await historyDigest(agent.streamHistory())).toStrictEqual(
          expectedDigest(1, bytes),
        );
        expect(replacement().owners.snapshot().liveRows).toBe(0);
        expect(
          replacement().owners.snapshot().peakSerializedBytes,
        ).toBeGreaterThan(carryBounds.serializedBytes);
      },
      bytes,
    );
  }, 180000);
});
