/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { accountingTexts } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { withAgentCarry } from './helpers/agent-carry-fixture.js';

function expectedTokens(size: number): number {
  let total = 0;
  for (let index = 0; index < size; index++) {
    for (const text of accountingTexts(index)) total += text.length;
  }
  return total;
}

describe('AgentImpl carried startup token accounting', () => {
  it.each([512, 8192])(
    'counts every mixed block and applies the startup system offset at %i rows',
    async (size) => {
      await withAgentCarry(size, async (agent, replacement) => {
        await agent.setModel('token-carried-model');
        const history = replacement().getHistoryService();
        if (history === null) throw new Error('Missing carried history');
        expect(history.getTotalTokens() - history.getBaseTokenOffset()).toBe(
          expectedTokens(size),
        );
        expect(history.getBaseTokenOffset()).toBeGreaterThan(0);
      });
    },
    180000,
  );
});
