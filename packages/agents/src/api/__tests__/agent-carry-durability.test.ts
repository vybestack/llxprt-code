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
    async (agent, replacement) => {
      const started = agent.setModel('durability-model');
      const outcome = started.then(
        () => undefined,
        (error: unknown) => error,
      );
      await replacement.ready;
      const next = replacement();
      await next.entered.promise;
      const history = next.getHistoryService();
      if (history === null) throw new Error('Missing carried journal');
      const tokens = history.getTotalTokens();
      const failure = vi
        .spyOn(SessionRecordingService.prototype, 'waitForCommit')
        .mockImplementation(async () => {
          throw new Error('Carried write acknowledgement failed');
        });
      try {
        next.proceed.open();
        expect(await outcome).toBeInstanceOf(Error);
        await expect(started).rejects.toThrow(
          'Carried write acknowledgement failed',
        );
      } finally {
        failure.mockRestore();
        next.proceed.open();
      }
      expect(next.hasChatInitialized()).toBe(false);
      expect(await historyDigest(next.streamHistory())).toStrictEqual(
        expectedDigest(size),
      );
      expect(history.getTotalTokens() - tokens).toBe(0);
      expect(next.owners.snapshot().liveRows).toBe(0);
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

describe('AgentImpl carried durable acknowledgement', () => {
  it.each([512, 8192])(
    'keeps the previous %i-row journal and token total when the final acknowledgement fails',
    async (size) => {
      expect(await verifyAcknowledgementFailure(size)).toBe(size);
    },
    180000,
  );
});
