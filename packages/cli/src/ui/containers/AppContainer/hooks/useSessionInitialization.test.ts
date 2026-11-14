/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect, spyOn } from 'bun:test';
import { act } from 'react';
import type { EmojiFilterMode } from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createTurnStore } from '../../../stores/turn/turnStore.js';
import { readJournalItems } from '../../../stores/turn/journal-turn-test-helpers.js';
import { useSessionInitialization } from './useSessionInitialization.js';

function initializationInputs(agent: Agent, counts = [0, 0]) {
  const turn = createTurnStore();
  turn.commands.bindJournal(() => ({
    appendDisplay: agent.session.appendDisplay.bind(agent.session),
    length: () => agent.session.getJournalLength(),
  }));
  return {
    triggerSessionStart: agent.hooks.triggerSessionStart.bind(agent.hooks),
    appendHookContext: async (text: string): Promise<void> => {
      await agent.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text }],
      });
    },
    readEmojiFilterMode: (): EmojiFilterMode => 'allowed',
    readLlxprtMdFileCount: () => counts[0],
    readCoreMemoryFileCount: () => counts[1],
    addItem: turn.commands.addItem,
  };
}

describe('session initialization', () => {
  it('initializes memory counts from the runtime', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockResolvedValue(
        {},
      );
      const view = renderHook(() =>
        useSessionInitialization({
          ...initializationInputs(agent, [3, 5]),
        }),
      );
      try {
        expect(view.result.current.llxprtMdFileCount).toBe(3);
        expect(view.result.current.coreMemoryFileCount).toBe(5);
      } finally {
        view.unmount();
        hook.mockRestore();
      }
    });
  });

  it('writes hook presentation and context once across rerenders without replaying a resume array', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockResolvedValue({
        systemMessage: 'welcome message',
        additionalContext: 'extra context',
      });
      const view = renderHook(() =>
        useSessionInitialization({
          ...initializationInputs(agent),
          resumedBoot: {
            async *streamRows() {
              yield await Promise.reject(
                new Error('Resume materialization forbidden'),
              );
            },
          },
        }),
      );
      try {
        await waitFor(async () =>
          expect(
            (await readJournalItems(agent)).map((item) => item.text),
          ).toStrictEqual(['welcome message', 'extra context']),
        );
        view.rerender();
        await act(async () => {
          await Promise.resolve();
        });
        expect(
          (await readJournalItems(agent)).map((item) => item.text),
        ).toStrictEqual(['welcome message', 'extra context']);
        expect(await agent.session.getHistory()).toMatchObject([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'extra context' }],
          },
        ]);
      } finally {
        view.unmount();
        hook.mockRestore();
      }
    });
  });

  it.each([false, true])(
    'does not publish delayed hook output after unmount, failure=%s',
    async (fail) => {
      await withRecordingLifetimeFixture(async ({ agent }) => {
        await agent.session.setRecording({ enabled: true });
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const hook = spyOn(
          agent.hooks,
          'triggerSessionStart',
        ).mockImplementation(async () => {
          await gate;
          if (fail) throw new Error('hook failed');
          return {
            systemMessage: 'late message',
            additionalContext: 'late context',
          };
        });
        const view = renderHook(() =>
          useSessionInitialization({
            ...initializationInputs(agent),
          }),
        );
        try {
          view.unmount();
          await act(async () => release());
          expect(await readJournalItems(agent)).toStrictEqual([]);
          expect(await agent.session.getHistory()).toStrictEqual([]);
        } finally {
          release();
          view.unmount();
          hook.mockRestore();
        }
      });
    },
  );
});
