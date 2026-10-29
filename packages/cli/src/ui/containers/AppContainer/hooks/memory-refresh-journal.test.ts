import { collectResumeRows } from '../../../../__tests__/resumeRows.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook } from '../../../../__tests__/render.js';
import { NativeJournalCursor } from '../../../stores/turn/native-journal-cursor.js';
import { useMemoryRefreshAction } from './useMemoryRefreshAction.js';

describe('memory refresh journal presentation', () => {
  it('awaits both refresh notices without using the UI ledger', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const { result, unmount } = renderHook(() =>
        useMemoryRefreshAction({
          refreshMemory: async () => {
            const refreshed = await agent.memory.refresh();
            return { ...refreshed, filePaths: [...refreshed.filePaths] };
          },
          readDebugMode: () => false,
          addItem: () => {
            throw new Error('Ledger write forbidden');
          },
          readHistory: () => ({
            appendDisplay: agent.session.appendDisplay.bind(agent.session),
          }),
          origin: agent.session,
          recordingOwner: 'agent',
          setLlxprtMdFileCount: () => {},
        }),
      );
      try {
        await act(async () => {
          await result.current();
        });
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('Missing journal path');
        const cursor = await NativeJournalCursor.open(path, {}, 10);
        try {
          const notices = (await cursor.pageBack(10)).entries.flatMap(
            (entry) =>
              entry.kind === 'projected' && entry.item.type === 'info'
                ? [entry.item.text]
                : [],
          );
          expect(notices).toHaveLength(2);
          expect(notices[1]).toBe(
            'Refreshing hierarchical memory (LLXPRT.md or other context files)...',
          );
          expect(notices[0]).toContain('Memory refreshed successfully.');
          expect(await collectResumeRows(agent.streamHistory())).toStrictEqual(
            [],
          );
        } finally {
          await cursor.close();
        }
      } finally {
        unmount();
      }
    });
  }, 30000);
});
