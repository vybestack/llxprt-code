/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { ConsoleMessageItem } from '../types.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { useCoreEventHandlers } from './useCoreEventHandlers.js';

describe('owner-backed UI feedback listener', () => {
  it('removes the old listener and writes only to the current Agent after owner replacement', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const firstPath = agent.session.getRecording().path;
      if (!firstPath) throw new Error('Missing first recording path');
      const rawWrite = vi.fn();
      const recordingIntegrationRef = {
        current: { recordSessionEvent: rawWrite },
      };
      const uiRuntime = { app: { getDebugMode: () => false } };
      const displayed: string[] = [];
      const { rerender, unmount } = renderHook(
        ({ owner }) =>
          useCoreEventHandlers({
            agent: owner,
            recordingOwner: 'agent',
            uiRuntime: uiRuntime as never,
            recordingIntegrationRef: recordingIntegrationRef as never,
            handleNewMessage: (message) => displayed.push(message.content),
          }),
        { initialProps: { owner: agent } },
      );
      coreEvents.emitFeedback('warning', 'first owner feedback');
      await waitFor(async () => {
        expect(await readFile(firstPath, 'utf8')).toContain(
          'first owner feedback',
        );
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
        expect(await readFile(nextPath, 'utf8')).toContain(
          'second owner feedback',
        );
      });
      expect(await readFile(firstPath, 'utf8')).not.toContain(
        'second owner feedback',
      );
      expect(rawWrite).not.toHaveBeenCalled();
      unmount();
      coreEvents.emit(CoreEvent.UserFeedback, {
        severity: 'warning',
        message: 'post-unmount owner feedback',
      });
      expect(
        displayed.filter((message) => message.includes('owner feedback')),
      ).toStrictEqual(['first owner feedback', 'second owner feedback']);
    });
  }, 30000);

  it('surfaces a recording writer failure as a UI error instead of dropping the flush promise', async () => {
    const writerFailure = new Error('disk full');
    const failingAgent = {
      session: {
        recordRecordingEvent: () => Promise.reject(writerFailure),
      },
    } as unknown as Agent;
    const uiRuntime = { app: { getDebugMode: () => false } };
    const displayed: ConsoleMessageItem[] = [];
    const { unmount } = renderHook(() =>
      useCoreEventHandlers({
        agent: failingAgent,
        recordingOwner: 'agent',
        uiRuntime: uiRuntime as never,
        handleNewMessage: (message) => displayed.push(message),
      }),
    );

    coreEvents.emitFeedback('warning', 'feedback while writer is broken');

    await waitFor(() => {
      expect(
        displayed.some(
          (message) =>
            message.type === 'error' && message.content.includes('disk full'),
        ),
      ).toBe(true);
    });
    unmount();
  });
});
