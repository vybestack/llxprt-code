/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { internalConfig } from './helpers/agentHarness.js';
import {
  carryBounds,
  expectedDigest,
  historyDigest,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

for (const size of [512, 8192]) {
  describe(`AgentImpl carry failure at ${size}`, () => {
    for (const fault of ['source', 'abort'] as const) {
      it(`preserves durable carried rows after ${fault} and permits a startup retry`, async () => {
        await withAgentCarry(
          size,
          async (agent, replacement) => {
            await expect(agent.setModel('failed-carry-model')).rejects.toThrow(
              fault === 'source'
                ? 'Carried source fault'
                : 'Carried source cancelled',
            );
            const next = replacement();
            expect(next.hasChatInitialized()).toBe(false);
            expect(await historyDigest(next.streamHistory())).toStrictEqual(
              expectedDigest(size),
            );
            expect(next.owners.snapshot().liveRows).toBe(0);
            expect(next.owners.within(carryBounds)).toBe(true);
            await next.startChat([]);
            expect(await historyDigest(agent.streamHistory())).toStrictEqual(
              expectedDigest(size),
            );
          },
          2048,
          (client) => {
            client.fault = fault;
          },
        );
      }, 180000);
    }

    it('keeps durable rows readable after runtime startup fails', async () => {
      await withAgentCarry(size, async (agent, replacement) => {
        const config = internalConfig(agent);
        const fault = vi
          .spyOn(config, 'getToolRegistry')
          .mockImplementation(() => {
            throw new Error('Startup tool fault');
          });
        try {
          await expect(agent.setModel('failed-start-model')).rejects.toThrow(
            'Startup tool fault',
          );
        } finally {
          fault.mockRestore();
        }
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
      });
    }, 180000);
  });
}
