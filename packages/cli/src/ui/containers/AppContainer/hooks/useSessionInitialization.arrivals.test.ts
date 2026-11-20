import { encodeJournalUiItem } from '../../../stores/turn/journal-ui-item.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect, spyOn } from 'bun:test';
import { act } from 'react';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { readJournalItems } from '../../../stores/turn/journal-turn-test-helpers.js';
import { useSessionInitialization } from './useSessionInitialization.js';

describe('journal resume arrivals', () => {
  it('keeps restored rows ahead of hook output and the next prompt and response', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'restored question' }],
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'restored answer' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockImplementation(
        async () => {
          await gate;
          return { systemMessage: 'hook message' };
        },
      );
      const view = renderHook(() =>
        useSessionInitialization({
          triggerSessionStart: agent.hooks.triggerSessionStart.bind(
            agent.hooks,
          ),
          appendHookContext: async (text) => {
            await agent.addHistory({
              speaker: 'human',
              blocks: [{ type: 'text', text }],
            });
          },
          readEmojiFilterMode: () => 'auto',
          readLlxprtMdFileCount: agent.memory.getFileCount.bind(agent.memory),
          readCoreMemoryFileCount: agent.memory.getCoreFileCount.bind(
            agent.memory,
          ),
          addItem: (item) => {
            void agent.session.appendDisplay(
              { type: 'ui-item' },
              encodeJournalUiItem(item),
            );
            return 0;
          },
        }),
      );
      try {
        expect(
          (await readJournalItems(agent)).map((item) => item.text),
        ).toStrictEqual(['restored question', 'restored answer']);
        await act(async () => release());
        await waitFor(async () =>
          expect((await readJournalItems(agent)).at(-1)?.text).toBe(
            'hook message',
          ),
        );
        await agent.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first prompt' }],
        });
        await agent.addHistory({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'first reply' }],
        });
        expect(
          (await readJournalItems(agent)).map((item) => item.text),
        ).toStrictEqual([
          'restored question',
          'restored answer',
          'hook message',
          'first prompt',
          'first reply',
        ]);
      } finally {
        release();
        view.unmount();
        hook.mockRestore();
      }
    });
  });
});
