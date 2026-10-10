/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { renderHook } from '../../../../__tests__/render.js';
import { LoadedSettings } from '../../../../config/settings.js';
import type { HistoryItem } from '../../../types.js';
import { useStreamEventHandlers } from '../useStreamEventHandlers.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

describe('CLI overflow guidance live provider port', () => {
  it('changes guidance from live provider limits using an adapter with no manager, client or Config', () => {
    let limit = 100;
    const history: Array<Omit<HistoryItem, 'id'>> = [];
    const emptySettings = { settings: {}, path: '' };
    const settings = new LoadedSettings(
      emptySettings,
      emptySettings,
      emptySettings,
      emptySettings,
      true,
    );
    const { result, unmount } = renderHook(() =>
      useStreamEventHandlers({
        runtime: createStreamRuntimeForTest({ getModel: () => 'local' }),
        agent: {
          getProviderContextLimit: () => limit,
          getProvider: () => 'local',
          getModel: () => 'local',
          getCurrentSequenceModel: () => null,
          getActiveProfileName: () => null,
          tools: { get: () => undefined },
          mcp: {
            findResource: () => undefined,
            readResource: async () => ({}),
          },
        },
        settings,
        addItem: (item) => {
          history.push(item);
          return history.length;
        },
        onDebugMessage: () => undefined,
        onCancelSubmit: () => undefined,
        sanitizeContent: (text) => ({ text, blocked: false }),
        flushPendingHistoryItem: () => undefined,
        pendingResponse: new PendingResponseBuffer(undefined),
        pendingHistoryItemRef: { current: null },
        thinkingBlocksRef: { current: [] },
        turnCancelledRef: { current: false },
        clearSubmissions: () => undefined,
        setPendingHistoryItem: () => undefined,
        setIsResponding: () => undefined,
        setThought: () => undefined,
        setLastAgentActivityTime: () => undefined,
        scheduleToolCalls: async () => undefined,
        abortActiveStream: () => undefined,
        handleShellCommand: () => false,
        handleSlashCommand: async () => false,
        logger: null,
        shellModeActive: false,
        loopDetectedRef: { current: false },
        lastProfileNameRef: { current: undefined },
        lastModelInfoRef: { current: null },
        lastModelIdentityRef: { current: null },
      }),
    );
    try {
      result.current.handleContextWindowWillOverflowEvent(101, 80);
      limit = 200;
      result.current.handleContextWindowWillOverflowEvent(201, 80);
      expect(history).toMatchObject([
        { text: expect.not.stringContaining('/compress') },
        { text: expect.stringContaining('/compress') },
      ]);
    } finally {
      unmount();
    }
  });
});
