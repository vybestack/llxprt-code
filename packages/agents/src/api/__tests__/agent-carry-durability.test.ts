/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import {
  expectedDigest,
  historyDigest,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

async function verifyAcknowledgementFailure(size: number): Promise<number> {
  return withAgentCarry(
    size,
    async (agent, replacement, previous) => {
      const started = agent.setModel('durability-model');
      const outcome = started.then(
        () => undefined,
        (error: unknown) => error,
      );
      await replacement.ready;
      const next = replacement();
      await next.entered.promise;
      const history = previous.getHistoryService();
      if (history === null) throw new Error('Missing previous journal');
      const tokens = history.getTotalTokens();
      // Only the carried write's acknowledgement fails; the rollback of that
      // admission acknowledges through the same recorder and must still succeed.
      const failure = vi
        .spyOn(SessionRecordingService.prototype, 'waitForCommitSequence')
        .mockImplementationOnce(async () => {
          throw new Error('Carried write acknowledgement failed');
        });
      try {
        next.proceed.open();
        expect(await outcome).toBeInstanceOf(Error);
        await expect(started).rejects.toThrow(
          'Carried write acknowledgement failed',
        );
        // The injected failure plus the rollback's own acknowledgement.
        expect(failure).toHaveBeenCalledTimes(2);
      } finally {
        failure.mockRestore();
        next.proceed.open();
      }
      expect(next.admissions).toBe(1);
      expect(next.hasChatInitialized()).toBe(false);
      expect(next.getHistoryService()).toBeNull();
      expect(await historyDigest(next.streamHistory())).toStrictEqual({
        count: 0,
        digest: expectedDigest(0).digest,
      });
      expect(next.owners.snapshot().liveRows).toBe(0);
      expect(agent.agentClient).toBe(previous);
      expect(history.getTotalTokens() - tokens).toBe(0);
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

describe('AgentImpl carried durable acknowledgement', () => {
  it.each([512, 8192])(
    'keeps the previous %i-row journal and token total when the final acknowledgement fails',
    async (size) => {
      expect(await verifyAcknowledgementFailure(size)).toBe(size);
    },
    180000,
  );
});
