import { collectResumeRows } from '../../../../__tests__/resumeRows.js';
import { encodeJournalUiItem } from '../../../stores/turn/journal-ui-item.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { NativeJournalCursor } from '../../../stores/turn/native-journal-cursor.js';
import { useSessionInitialization } from './useSessionInitialization.js';

describe('SessionStart journal notice', () => {
  it('persists a pre-prompt hook message without a UI history item', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const hook = spyOn(agent.hooks, 'triggerSessionStart').mockResolvedValue({
        systemMessage: 'Session hook persisted',
      });
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
          resumedBoot: {
            async *streamRows() {
              yield await Promise.reject(
                new Error('Resume array materialization forbidden'),
              );
            },
          },
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
        expect(await collectResumeRows(agent.streamHistory())).toStrictEqual(
          [],
        );
      } finally {
        view.unmount();
        hook.mockRestore();
      }
    });
  }, 30000);
});
