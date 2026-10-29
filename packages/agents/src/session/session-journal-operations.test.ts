/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createTestAgentClient } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { SessionConversationBinding } from './session-conversation-binding.js';

describe('session journal context observation', () => {
  it('publishes the current range and follows a replacement history without retaining the retired listener', async () => {
    const first = new HistoryService();
    const second = new HistoryService();
    let active = first;
    const binding = new SessionConversationBinding({
      readClient: () =>
        createTestAgentClient({ getHistoryService: () => active }),
      assertOpen: () => {},
    });
    const counts: number[] = [];
    const observers = new Set<() => void | Promise<void>>();
    const stop = binding.subscribeContextRange(observers, (range) => {
      counts.push(range.totalEntries);
    });
    try {
      expect(counts).toStrictEqual([0]);
      first.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first' }],
      });
      await first.waitForTokenUpdates();
      expect(counts[counts.length - 1]).toBe(1);
      active = second;
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(counts[counts.length - 1]).toBe(0);
      first.add({ speaker: 'ai', blocks: [{ type: 'text', text: 'retired' }] });
      await first.waitForTokenUpdates();
      expect(counts).toStrictEqual([0, 1, 0]);
      second.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'current' }],
      });
      await second.waitForTokenUpdates();
      expect(counts[counts.length - 1]).toBe(1);
    } finally {
      stop();
      await first.dispose();
      await second.dispose();
    }
    expect(observers.size).toBe(0);
  });
});
