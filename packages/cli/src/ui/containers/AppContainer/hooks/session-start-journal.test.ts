/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { buildUiRuntimeFromSource } from '../../../cliUiRuntime.js';
import { NativeJournalCursor } from '../../../stores/turn/native-journal-cursor.js';
import { useSessionInitialization } from './useSessionInitialization.js';

describe('SessionStart journal notice', () => {
  it('persists a pre-prompt hook message without a UI history item', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      await agent.session.setRecording({ enabled: true });
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockResolvedValue({
        systemMessage: 'Session hook persisted',
      });
      const view = renderHook(() =>
        useSessionInitialization({
          agent,
          uiRuntime: buildUiRuntimeFromSource(config, agent),
          recordingOwner: 'agent',
          resumedBoot: {
            async *streamRows() {
              yield await Promise.reject(
                new Error('Resume array materialization forbidden'),
              );
            },
          },
          addItem: () => {
            throw new Error('Ledger write forbidden');
          },
          prependHistory: () => {
            throw new Error('Resume materialization forbidden');
          },
        }),
      );
      try {
        await waitFor(async () => {
          const path = agent.session.getRecording().path;
          expect(path).not.toBeNull();
          if (!path) throw new Error('Journal not yet materialized');
          const cursor = await NativeJournalCursor.open(path, {}, 10);
          try {
            const entries = (await cursor.pageBack(10)).entries;
            expect(
              entries.flatMap((entry) =>
                entry.kind === 'projected' ? [entry.item.text] : [],
              ),
            ).toStrictEqual(['Session hook persisted']);
          } finally {
            await cursor.close();
          }
        });
        expect(await agent.session.getHistory()).toStrictEqual([]);
      } finally {
        view.unmount();
        hook.mockRestore();
      }
    });
  }, 30000);
});
