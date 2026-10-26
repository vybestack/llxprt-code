/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

const prompt: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'expanded prompt' }],
};

describe('durable prompt submissions', () => {
  it('publishes a prompt once across repeated submissions before opening its request', async () => {
    const history = new HistoryService();
    try {
      await history.submitPrompt('submission-one', [prompt]);
      const first = await history.prepareCuratedForProviderSnapshot();
      try {
        expect(first.count).toBe(1);
        expect(first.isPending(0)).toBe(false);
      } finally {
        await first.close();
      }
      await history.submitPrompt('submission-one', [prompt]);
      expect(await history.countCuratedRows()).toBe(1);
      await history.submitPrompt('submission-two', [prompt]);
      expect(await history.countCuratedRows()).toBe(2);
    } finally {
      await history.dispose();
    }
  });

  it('serializes concurrent retries without duplicating their prompt', async () => {
    const history = new HistoryService();
    try {
      await Promise.all([
        history.submitPrompt('same', [prompt]),
        history.submitPrompt('same', [prompt]),
      ]);
      expect(await history.countCuratedRows()).toBe(1);
      expect(await history.hasPromptSubmission('same')).toBe(true);
    } finally {
      await history.dispose();
    }
  });

  it('aborts the entire submission when an injected row is invalid', async () => {
    const history = new HistoryService();
    try {
      await expect(
        history.submitPrompt('invalid', [
          prompt,
          { speaker: 'human', blocks: [] },
        ]),
      ).rejects.toThrow('content has no blocks');
      expect(await history.countCuratedRows()).toBe(0);
      expect(await history.hasPromptSubmission('invalid')).toBe(false);
      await history.submitPrompt('invalid', [prompt]);
      expect(await history.countCuratedRows()).toBe(1);
    } finally {
      await history.dispose();
    }
  });
});
