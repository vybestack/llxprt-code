/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import {
  type CarryProbeClient,
  carryBounds,
  expectedDigest,
  historyDigest,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

// Only the first replacement client faults, so the retry can succeed.
function faultFirstReplacement(
  fault: 'source' | 'abort',
): (client: CarryProbeClient) => void {
  let faulted = false;
  return (client) => {
    if (faulted) return;
    faulted = true;
    client.fault = fault;
  };
}

for (const size of [512, 8192]) {
  describe(`AgentImpl carry failure at ${size}`, () => {
    for (const fault of ['source', 'abort'] as const) {
      it(`preserves durable carried rows after ${fault} and permits a startup retry`, async () => {
        await withAgentCarry(
          size,
          async (agent, replacement, previous) => {
            await expect(agent.setModel('failed-carry-model')).rejects.toThrow(
              fault === 'source'
                ? 'Carried source fault'
                : 'Carried source cancelled',
            );
            // Client replacement makes one admission into the new client; its
            // failure rolls that admission back and the previous client keeps
            // the durable rows.
            const next = replacement();
            expect(next.admissions).toBe(1);
            expect(next.hasChatInitialized()).toBe(false);
            expect(next.getHistoryService()).toBeNull();
            expect(await historyDigest(next.streamHistory())).toStrictEqual({
              count: 0,
              digest: expectedDigest(0).digest,
            });
            expect(next.owners.snapshot().liveRows).toBe(0);
            expect(next.owners.within(carryBounds)).toBe(true);
            expect(agent.agentClient).toBe(previous);
            expect(await historyDigest(agent.streamHistory())).toStrictEqual(
              expectedDigest(size),
            );
            await agent.setModel('retried-carry-model');
            expect(agent.agentClient).not.toBe(previous);
            expect(await historyDigest(agent.streamHistory())).toStrictEqual(
              expectedDigest(size),
            );
          },
          2048,
          faultFirstReplacement(fault),
        );
      }, 180000);
    }

    it('keeps durable rows readable after runtime startup fails', async () => {
      await withAgentCarry(
        size,
        async (agent, replacement) => {
          await expect(agent.setModel('failed-start-model')).rejects.toThrow(
            'Startup tool fault',
          );
          const next = replacement();
          expect(next.hasChatInitialized()).toBe(false);
          expect(await historyDigest(next.streamHistory())).toStrictEqual(
            expectedDigest(size),
          );
          expect(next.owners.snapshot().liveRows).toBe(0);
          await next.startChat([]);
          expect(await historyDigest(agent.streamHistory())).toStrictEqual(
            expectedDigest(size),
          );
        },
        2048,
        (client) => {
          vi.spyOn(client, 'startChat').mockRejectedValueOnce(
            new Error('Startup tool fault'),
          );
        },
      );
    }, 180000);
  });
}
