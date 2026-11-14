/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildAgent, countType, drain } from './helpers/agentHarness.js';
import { buildReplayProviderAgent } from './helpers/replay-provider-agent.js';

describe('agent harness environment isolation', () => {
  let previousReplay: string | undefined;
  beforeEach(() => {
    previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    delete process.env.LLXPRT_FAKE_RESPONSES;
  });
  afterEach(() => {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  });

  it('allows a contributed-provider fixture while a replay-seam fixture is still alive', async () => {
    const first = await buildAgent('plain-text.jsonl');
    try {
      expect(process.env.LLXPRT_FAKE_RESPONSES).toBeUndefined();
      const second = await buildReplayProviderAgent({
        initial: {
          alias: 'replay-isolated',
          script: { fixtureRelPath: 'plain-text.jsonl' },
        },
      });
      try {
        const firstEvents = await drain(first.agent.stream('first fixture'));
        const secondEvents = await drain(second.agent.stream('second fixture'));
        expect(countType(firstEvents, 'done')).toBe(1);
        expect(countType(firstEvents, 'text')).toBeGreaterThan(0);
        expect(countType(secondEvents, 'done')).toBe(1);
        expect(countType(secondEvents, 'text')).toBeGreaterThan(0);
      } finally {
        await second.cleanup();
      }
    } finally {
      await first.cleanup();
    }
  });
});
