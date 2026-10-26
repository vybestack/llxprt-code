/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  expectedDigest,
  historyDigest,
  withAgentCarry,
} from './helpers/agent-carry-fixture.js';
import { carryAcknowledgementFailure } from './helpers/carry-acknowledgement-failure.js';

async function verifyAcknowledgementFailure(size: number): Promise<number> {
  return withAgentCarry(
    size,
    async (agent, replacement, previous) => {
      const failure = carryAcknowledgementFailure(
        'Carried write acknowledgement failed',
      );
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
      failure.arm();
      try {
        next.proceed.open();
        expect(await outcome).toBeInstanceOf(Error);
        await expect(started).rejects.toThrow(
          'Carried write acknowledgement failed',
        );
        expect(failure.rejectedTrailer?.position).toBeGreaterThan(0);
        expect(failure.rejectedTrailer?.path).not.toBe(history.journalPath());
      } finally {
        failure.restore();
        next.proceed.open();
      }
      expect(next.admissions).toBe(1);
      expect(next.visited).toBe(size);
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
  it.each([65])(
    'keeps the previous %i-row journal and token total when the final acknowledgement fails',
    async (size) => {
      expect(await verifyAcknowledgementFailure(size)).toBe(size);
    },
    180000,
  );
});
