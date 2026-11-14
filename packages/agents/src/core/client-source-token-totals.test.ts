/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { accountingFactory } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCliStyleConfig } from '../api/__tests__/helpers/buildCliStyleConfig.js';

const text = 'acknowledged checkpoint row';

async function* rows(): AsyncGenerator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function replacedTotal(chatActive: boolean): Promise<number> {
  const built = await buildCliStyleConfig('plain-text.jsonl');
  await built.sessionClient.clients.refreshAuth();
  const client = built.agentClient;
  try {
    const tokenizer = accountingFactory((value) => value.length);
    client.bindTokenization(tokenizer.getTokenizer, tokenizer);
    if (chatActive) {
      await client.startChat([]);
      // Isolate row tokens from the system-prompt offset an active chat adds.
      client.getHistoryService()?.setBaseTokenOffset(0);
    }
    expect(client.hasChatInitialized()).toBe(chatActive);
    await client.setHistoryFromSource(rows());
    const history = client.getHistoryService();
    if (history === null) throw new Error('Missing replacement history');
    return history.getTotalTokens();
  } finally {
    await client.dispose();
    await built.cleanup();
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
