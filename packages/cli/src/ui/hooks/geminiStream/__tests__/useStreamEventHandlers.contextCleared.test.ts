/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type React from 'react';
import {
  GeminiEventType as ServerGeminiEventType,
  type Config,
  type ServerGeminiStreamEvent,
  type ThinkingBlock,
  type ThoughtSummary,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../test-utils/render.js';
import { useStreamEventHandlers } from '../useStreamEventHandlers.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import { MessageType, type HistoryItemWithoutId } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';

const mockConfig = {
  getModel: vi.fn(() => 'gemini-2.5-pro'),
  getMaxSessionTurns: vi.fn(() => 42),
  getEphemeralSetting: vi.fn(() => undefined),
} as unknown as Config;

const mockSettings = {
  merged: { ui: { showCitations: false } },
} as LoadedSettings;

function setupContextClearTest() {
  const addItem = vi.fn();
  const setThought = vi.fn() as React.Dispatch<
    React.SetStateAction<ThoughtSummary | null>
  >;
  const setLastGeminiActivityTime = vi.fn() as React.Dispatch<
    React.SetStateAction<number>
  >;

  const pendingHistoryItemRef = {
    current: null as HistoryItemWithoutId | null,
  };
  const setPendingHistoryItem = vi.fn((value) => {
    pendingHistoryItemRef.current =
      typeof value === 'function'
        ? value(pendingHistoryItemRef.current)
        : value;
  }) as React.Dispatch<React.SetStateAction<HistoryItemWithoutId | null>>;

  const thinkingBlocksRef = { current: [] as ThinkingBlock[] };
  const turnCancelledRef = { current: false };
  const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
  const loopDetectedRef = { current: false };
  const lastProfileNameRef = { current: undefined as string | undefined };

  const { result } = renderHook(() =>
    useStreamEventHandlers({
      config: mockConfig,
      settings: mockSettings,
      addItem,
      onDebugMessage: vi.fn(),
      onCancelSubmit: vi.fn(),
      sanitizeContent: (text: string) => ({ text, blocked: false }),
      flushPendingHistoryItem: vi.fn((timestamp: number) => {
        const pending = pendingHistoryItemRef.current;
        if (pending) {
          addItem(pending, timestamp);
          pendingHistoryItemRef.current = null;
        }
      }),
      pendingHistoryItemRef,
      thinkingBlocksRef,
      turnCancelledRef,
      queuedSubmissionsRef,
      setPendingHistoryItem,
      setIsResponding: vi.fn(),
      setThought,
      setLastGeminiActivityTime,
      scheduleToolCalls: vi.fn().mockResolvedValue(undefined),
      abortActiveStream: vi.fn(),
      handleShellCommand: vi.fn(() => false),
      handleSlashCommand: vi.fn().mockResolvedValue(false),
      logger: null,
      shellModeActive: false,
      loopDetectedRef,
      lastProfileNameRef,
    }),
  );

  return {
    result,
    addItem,
    pendingHistoryItemRef,
  };
}

describe('useStreamEventHandlers contextCleared buffering', () => {
  it('flushes pending Gemini text and resets buffer on AgentExecutionStopped context clear mid-stream', async () => {
    const { result, addItem, pendingHistoryItemRef } = setupContextClearTest();

    const stream =
      (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        yield { type: ServerGeminiEventType.Content, value: 'Before clear ' };
        yield {
          type: ServerGeminiEventType.AgentExecutionStopped,
          reason: 'Stopped by hook',
          contextCleared: true,
        };
        yield { type: ServerGeminiEventType.Content, value: 'After clear' };
      })();

    await act(async () => {
      await result.current.processGeminiStreamEvents(
        stream,
        101,
        new AbortController().signal,
      );
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gemini',
        text: 'Before clear ',
      }),
      101,
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Execution stopped by hook: Stopped by hook',
      }),
      101,
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      }),
      101,
    );
    expect(pendingHistoryItemRef.current).toStrictEqual(
      expect.objectContaining({
        type: 'gemini',
        text: 'After clear',
      }),
    );
    expect(pendingHistoryItemRef.current?.text).not.toContain('Before clear');
    expect(addItem).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gemini',
        text: 'Before clear After clear',
      }),
      101,
    );
  });

  it('flushes pending Gemini text and resets buffer on AgentExecutionBlocked context clear', async () => {
    const { result, addItem, pendingHistoryItemRef } = setupContextClearTest();

    const stream =
      (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        yield { type: ServerGeminiEventType.Content, value: 'Before clear ' };
        yield {
          type: ServerGeminiEventType.AgentExecutionBlocked,
          reason: 'Blocked by hook',
          contextCleared: true,
        };
        yield { type: ServerGeminiEventType.Content, value: 'After clear' };
      })();

    await act(async () => {
      await result.current.processGeminiStreamEvents(
        stream,
        102,
        new AbortController().signal,
      );
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gemini',
        text: 'Before clear ',
      }),
      102,
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Execution blocked by hook: Blocked by hook',
      }),
      102,
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      }),
      102,
    );
    expect(pendingHistoryItemRef.current).toStrictEqual(
      expect.objectContaining({
        type: 'gemini',
        text: 'After clear',
      }),
    );
    expect(pendingHistoryItemRef.current?.text).not.toContain('Before clear');
    expect(addItem).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gemini',
        text: 'Before clear After clear',
      }),
      102,
    );
  });
});
