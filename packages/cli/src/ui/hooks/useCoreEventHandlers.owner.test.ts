/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import type { ConsoleMessageItem } from '../types.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { buildUiRuntimeFromSource } from '../cliUiRuntime.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { useCoreEventHandlers } from './useCoreEventHandlers.js';

async function notices(path: string): Promise<string[]> {
  const cursor = await NativeJournalCursor.open(path, {}, 10);
  try {
    return (await cursor.pageBack(10)).entries.flatMap((entry) =>
      entry.kind === 'projected' &&
      entry.contextState === 'n/a' &&
      entry.item.text !== undefined
        ? [entry.item.text]
        : [],
    );
  } finally {
    await cursor.close();
  }
}

describe('owner-backed UI feedback listener', () => {
  it('removes the old listener and journals each feedback once after owner replacement', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow, config }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const firstPath = agent.session.getRecording().path;
      if (!firstPath) throw new Error('Missing first recording path');
      const displayed: string[] = [];
      const { rerender, unmount } = renderHook(
        ({ owner }) =>
          useCoreEventHandlers({
            agent: owner,
            recordingOwner: 'agent',
            uiRuntime: buildUiRuntimeFromSource(config, owner),
            handleNewMessage: (message) => displayed.push(message.content),
          }),
        { initialProps: { owner: agent } },
      );
      try {
        coreEvents.emitFeedback('warning', 'first owner feedback');
        await waitFor(async () => {
          expect(await notices(firstPath)).toStrictEqual([
            'first owner feedback',
          ]);
        });
        await agent.session.setRecording({ enabled: false });
        const next = await borrow();
        await next.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'second' }] },
        ]);
        await next.session.setRecording({ enabled: true });
        const nextPath = next.session.getRecording().path;
        if (!nextPath) throw new Error('Missing second recording path');
        rerender({ owner: next });
        coreEvents.emitFeedback('error', 'second owner feedback');
        await waitFor(async () => {
          expect(await notices(nextPath)).toStrictEqual([
            'second owner feedback',
          ]);
        });
        expect(await notices(firstPath)).toStrictEqual([
          'first owner feedback',
        ]);
        unmount();
        coreEvents.emit(CoreEvent.UserFeedback, {
          severity: 'warning',
          message: 'post-unmount owner feedback',
        });
        expect(await notices(nextPath)).toStrictEqual([
          'second owner feedback',
        ]);
        expect(displayed).toStrictEqual([]);
      } finally {
        unmount();
      }
    });
  }, 30000);

  it('surfaces a recording writer failure as a UI error instead of dropping the flush promise', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      await agent.session.setRecording({ enabled: true });
      const history = agent.agentClient.getHistoryService();
      if (!history) throw new Error('Missing history service');
      const failure = spyOn(history, 'appendDisplay').mockRejectedValue(
        new Error('disk full'),
      );
      const displayed: ConsoleMessageItem[] = [];
      const { unmount } = renderHook(() =>
        useCoreEventHandlers({
          agent,
          recordingOwner: 'agent',
          uiRuntime: buildUiRuntimeFromSource(config, agent),
          handleNewMessage: (message) => displayed.push(message),
        }),
      );
      try {
        coreEvents.emitFeedback('warning', 'feedback while writer is broken');
        await waitFor(() => {
          expect(
            displayed.map((message) => [message.type, message.content]),
          ).toStrictEqual([
            ['error', 'Failed to record session event: disk full'],
          ]);
        });
      } finally {
        unmount();
        failure.mockRestore();
      }
    });
  }, 30000);
});
