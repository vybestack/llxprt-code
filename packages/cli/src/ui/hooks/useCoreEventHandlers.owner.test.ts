import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { describe, expect, it, vi } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import { Agent } from '@vybestack/llxprt-code-agents';
import { ConsoleMessageItem } from '../types.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { useCoreEventHandlers } from './useCoreEventHandlers.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('owner-backed UI feedback listener', () => {
  useRecordingPrompts();
  it('removes the old listener and writes only to the current Agent after owner replacement', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        _config,
        _settingsOwner,
        _settingsService,
        _oauthManager,
        borrow,
      ) => {
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
        const displayed: string[] = [];
        const handleNewMessage = (message: ConsoleMessageItem) =>
          displayed.push(message.content);
        const readDebugMode = () => false;
        const hookOptionsFor = (owner: Agent) =>
          Object.assign(
            { recordingIntegrationRef },
            {
              readDebugMode,
              recordFeedback: (
                severity: 'warning' | 'error',
                message: string,
              ) =>
                owner.session.recordRecordingEvent({
                  type: 'session_event',
                  severity,
                  message,
                }),
              handleNewMessage,
            },
          );
        const { rerender, unmount } = renderHook(
          ({ options }) => useCoreEventHandlers(options),
          { initialProps: { options: hookOptionsFor(agent) } },
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
        rerender({ options: hookOptionsFor(next) });
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
      },
    );
  }, 30000);

  it('surfaces a recording writer failure as a UI error instead of dropping the flush promise', async () => {
    const writerFailure = new Error('disk full');
    const recordFeedback = () => Promise.reject(writerFailure);
    const readDebugMode = () => false;
    const displayed: ConsoleMessageItem[] = [];
    const handleNewMessage = (message: ConsoleMessageItem) =>
      displayed.push(message);
    const { unmount } = renderHook(() =>
      useCoreEventHandlers({
        recordFeedback,
        readDebugMode,
        handleNewMessage,
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
