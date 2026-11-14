import { collectResumeRows } from '../../__tests__/resumeRows.js';
import { encodeJournalUiItem } from '../stores/turn/journal-ui-item.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { coreEvents } from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { useCoreEventHandlers } from './useCoreEventHandlers.js';

describe('core feedback journal presentation', () => {
  it('journals all severities rather than retaining a console-message copy', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const consoleMessages: string[] = [];
      const view = renderHook(() =>
        useCoreEventHandlers({
          readDebugMode: () => false,
          recordFeedback: async (severity, message) => {
            await agent.session.appendDisplay(
              { type: 'ui-item' },
              encodeJournalUiItem({ type: severity, text: message }),
            );
          },
          handleNewMessage: (message) => {
            consoleMessages.push(message.content);
          },
        }),
      );
      try {
        coreEvents.emitFeedback('info', 'MCP ready');
        coreEvents.emitFeedback('warning', 'Hook warning');
        coreEvents.emitFeedback('error', 'Auth failure');
        await waitFor(async () => {
          const path = agent.session.getRecording().path;
          if (!path) throw new Error('Journal not materialized');
          const cursor = await NativeJournalCursor.open(path, {}, 10);
          try {
            expect(
              (await cursor.pageBack(10)).entries.flatMap((entry) =>
                entry.kind === 'projected'
                  ? [[entry.item.type, entry.item.text]]
                  : [],
              ),
            ).toStrictEqual([
              ['error', 'Auth failure'],
              ['warning', 'Hook warning'],
              ['info', 'MCP ready'],
            ]);
          } finally {
            await cursor.close();
          }
        });
        expect(consoleMessages).toStrictEqual([]);
        expect(await collectResumeRows(agent.streamHistory())).toStrictEqual(
          [],
        );
      } finally {
        view.unmount();
      }
    });
  }, 30000);
});
