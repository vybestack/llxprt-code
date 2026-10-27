/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect, spyOn } from 'bun:test';
import { act } from 'react';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { buildUiRuntimeFromSource } from '../../../cliUiRuntime.js';
import { readJournalItems } from '../../../stores/turn/journal-turn-test-helpers.js';
import { useSessionInitialization } from './useSessionInitialization.js';

const forbiddenAdd = (): number => {
  throw new Error('UI ledger forbidden');
};

describe('session initialization', () => {
  it('initializes memory counts from the runtime', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      const runtime = buildUiRuntimeFromSource(config, agent);
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockResolvedValue(
        {},
      );
      const view = renderHook(() =>
        useSessionInitialization({
          uiRuntime: {
            ...runtime,
            memory: {
              ...runtime.memory,
              getLlxprtMdFileCount: () => 3,
              getCoreMemoryFileCount: () => 5,
            },
          },
          agent,
          addItem: forbiddenAdd,
          recordingOwner: 'agent',
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
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      await agent.session.setRecording({ enabled: true });
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockResolvedValue({
        systemMessage: 'welcome message',
        additionalContext: 'extra context',
      });
      const runtime = buildUiRuntimeFromSource(config, agent);
      const view = renderHook(() =>
        useSessionInitialization({
          uiRuntime: runtime,
          agent,
          addItem: forbiddenAdd,
          recordingOwner: 'agent',
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
      await withRecordingLifetimeFixture(async ({ agent, config }) => {
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
            uiRuntime: buildUiRuntimeFromSource(config, agent),
            agent,
            addItem: forbiddenAdd,
            recordingOwner: 'agent',
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
