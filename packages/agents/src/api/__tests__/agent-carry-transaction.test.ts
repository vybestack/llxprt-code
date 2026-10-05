/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import {
  expectedDigest,
  historyDigest,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

async function verifyUnchangedDurableSource(size: number): Promise<number> {
  return withAgentCarry(
    size,
    async (agent, replacement) => {
      const started = agent.setModel('transaction-carried-model');
      const outcome = started.then(
        () => undefined,
        (error: unknown) => error,
      );
      await replacement.ready;
      const next = replacement();
      await next.entered.promise;
      const source = next.getHistoryService();
      if (source === null) throw new Error('Missing carried source');
      const before = await source.withRawHistorySnapshot(
        async (snapshot) => snapshot.durableTail,
      );
      const failure = vi
        .spyOn(SessionRecordingService.prototype, 'waitForCommit')
        .mockImplementation(async () => {
          throw new Error('Candidate durable acknowledgement failed');
        });
      try {
        next.proceed.open();
        expect(await outcome).toBeInstanceOf(Error);
        await expect(started).rejects.toThrow(
          'Candidate durable acknowledgement failed',
        );
      } finally {
        failure.mockRestore();
        next.proceed.open();
      }
      await source.waitForOwnershipSettlement();
      const after = await source.withRawHistorySnapshot(
        async (snapshot) => snapshot.durableTail,
      );
      expect(after - before).toBe(0);
      expect(next.getHistoryService() === source).toBe(true);
      expect(await historyDigest(next.streamHistory())).toStrictEqual(
        expectedDigest(size),
      );
      expect(next.owners.snapshot().liveRows).toBe(0);
      await next.setHistoryFromSource(next.streamHistory());
      expect(next.getHistoryService() === source).toBe(false);
      await next.startChat([]);
      const restored = await historyDigest(agent.streamHistory());
      expect(restored).toStrictEqual(expectedDigest(size));
      return restored.count;
    },
    2048,
    (client) => {
      client.pause = true;
    },
  );
}

describe('AgentImpl carried source transaction', () => {
  it.each([512, 8192])(
    'does not rewrite the durable %i-row source on failed admission and swaps only after retry',
    async (size) => {
      expect(await verifyUnchangedDurableSource(size)).toBe(size);
    },
    180000,
  );
});
