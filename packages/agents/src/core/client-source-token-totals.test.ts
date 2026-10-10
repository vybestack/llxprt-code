/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { accountingFactory } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';

const text = 'acknowledged checkpoint row';

async function* rows(): AsyncGenerator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function replacedTotal(chatActive: boolean): Promise<number> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  try {
    const config = internalConfig(agent);
    config.setTokenizerFactory(accountingFactory((value) => value.length));
    const client = config.getAgentClient();
    if (chatActive) {
      await client.startChat([]);
      // Isolate row tokens from the system-prompt offset an active chat adds.
      client.getHistoryService()?.setBaseTokenOffset(0);
    }
    await client.setHistoryFromSource(rows());
    const history = client.getHistoryService();
    if (history === null) throw new Error('Missing replacement history');
    return history.getTotalTokens();
  } finally {
    await cleanup();
  }
}

describe('setHistoryFromSource token totals', () => {
  it.each([false, true])(
    'equal the estimate of the admitted rows, chat active=%s',
    async (chatActive) => {
      expect(await replacedTotal(chatActive)).toBe(text.length);
    },
  );
});
