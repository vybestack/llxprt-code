/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { statSync } from 'node:fs';
import { describe, expect, it, vi } from 'bun:test';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import {
  expectedDigest,
  historyDigest,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';

/** Size of the durable journal file: a rewrite of the source would change it. */
function durableBytes(journalPath: string | null): number {
  if (journalPath === null) throw new Error('Missing carried source journal');
  return statSync(journalPath).size;
}

async function verifyUnchangedDurableSource(size: number): Promise<number> {
  let paused = false;
  return withAgentCarry(
    size,
    async (agent, replacement, previous) => {
      const started = agent.setModel('transaction-carried-model');
      const outcome = started.then(
        () => undefined,
        (error: unknown) => error,
      );
      await replacement.ready;
      const next = replacement();
      await next.entered.promise;
      // The replacement has no journal while its single admission is paused;
      // the durable source is still the previous client's.
      const source = previous.getHistoryService();
      if (source === null) throw new Error('Missing carried source');
      await source.waitForCommit();
      const before = durableBytes(source.journalPath());
      const failure = vi
        .spyOn(SessionRecordingService.prototype, 'waitForCommitSequence')
        .mockImplementationOnce(async () => {
          throw new Error('Candidate durable acknowledgement failed');
        });
      try {
        next.proceed.open();
        expect(await outcome).toBeInstanceOf(Error);
        await expect(started).rejects.toThrow(
          'Candidate durable acknowledgement failed',
        );
        // The injected failure plus the rollback's own acknowledgement.
        expect(failure).toHaveBeenCalledTimes(2);
      } finally {
        failure.mockRestore();
        next.proceed.open();
      }
      await source.waitForOwnershipSettlement();
      await source.waitForCommit();
      const after = durableBytes(source.journalPath());
      expect(after - before).toBe(0);
      expect(next.admissions).toBe(1);
      expect(next.getHistoryService()).toBeNull();
      expect(agent.agentClient).toBe(previous);
      expect(previous.getHistoryService() === source).toBe(true);
      expect(await historyDigest(next.streamHistory())).toStrictEqual({
        count: 0,
        digest: expectedDigest(0).digest,
      });
      expect(next.owners.snapshot().liveRows).toBe(0);
      expect(await historyDigest(agent.streamHistory())).toStrictEqual(
        expectedDigest(size),
      );
      await agent.setModel('transaction-retried-model');
      expect(agent.agentClient).not.toBe(previous);
      expect(agent.agentClient.getHistoryService() === source).toBe(false);
      const restored = await historyDigest(agent.streamHistory());
      expect(restored).toStrictEqual(expectedDigest(size));
      return restored.count;
    },
    2048,
    // Only the first replacement pauses and fails; the retry runs unpaused.
    (client) => {
      if (paused) return;
      paused = true;
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
