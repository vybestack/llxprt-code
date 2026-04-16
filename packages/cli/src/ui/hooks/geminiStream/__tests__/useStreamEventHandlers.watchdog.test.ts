/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import {
  GeminiEventType as ServerGeminiEventType,
  type Config,
  type ServerGeminiStreamEvent,
  type ThinkingBlock,
  type ThoughtSummary,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../test-utils/render.js';
import {
  useStreamEventHandlers,
  __testing,
} from '../useStreamEventHandlers.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import { MessageType, type HistoryItemWithoutId } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';

describe('useStreamEventHandlers stalled-stream watchdog', () => {
  const mockConfig = {
    getModel: vi.fn(() => 'gemini-2.5-pro'),
    getMaxSessionTurns: vi.fn(() => 42),
  } as unknown as Config;

  const mockSettings = {
    merged: { ui: { showCitations: false } },
  } as LoadedSettings;

  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockScheduleToolCalls: ReturnType<typeof vi.fn>;
  let setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  let setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
  let setLastGeminiActivityTime: React.Dispatch<React.SetStateAction<number>>;
  let abortActiveStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAddItem = vi.fn();
    mockScheduleToolCalls = vi.fn().mockResolvedValue(undefined);
    abortActiveStream = vi.fn();
    setThought = vi.fn();
    setLastGeminiActivityTime = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a stalled stream after partial content without scheduling buffered tool calls', async () => {
    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    setPendingHistoryItem = vi.fn((value) => {
      pendingHistoryItemRef.current =
        typeof value === 'function'
          ? value(pendingHistoryItemRef.current)
          : value;
    });
    const thinkingBlocksRef = { current: [] as ThinkingBlock[] };
    const turnCancelledRef = { current: false };
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const loopDetectedRef = { current: false };
    const lastProfileNameRef = { current: undefined as string | undefined };

    const { result } = renderHook(() =>
      useStreamEventHandlers({
        config: mockConfig,
        settings: mockSettings,
        addItem: mockAddItem,
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: vi.fn(),
        pendingHistoryItemRef,
        thinkingBlocksRef,
        turnCancelledRef,
        queuedSubmissionsRef,
        setPendingHistoryItem,
        setIsResponding: vi.fn(),
        setThought,
        setLastGeminiActivityTime,
        scheduleToolCalls: mockScheduleToolCalls,
        abortActiveStream,
        handleShellCommand: vi.fn(() => false),
        handleSlashCommand: vi.fn().mockResolvedValue(false),
        logger: null,
        shellModeActive: false,
        loopDetectedRef,
        lastProfileNameRef,
      }),
    );

    const signalController = new AbortController();
    const stalledStream =
      (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Partial output',
        };
        await new Promise(() => {});
      })();

    const runPromise = result.current.processGeminiStreamEvents(
      stalledStream,
      123,
      signalController.signal,
    );
    const runPromiseExpectation = runPromise.then(
      () => {
        throw new Error('Expected stalled stream to timeout');
      },
      (error) => {
        expect(error).toMatchObject({
          name: 'StreamIdleTimeoutError',
          message:
            'Stream idle timeout: no response received within the allowed time.',
        });
      },
    );

    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(
      __testing.GEMINI_STREAM_IDLE_TIMEOUT_MS + 1,
    );

    await runPromiseExpectation;
    expect(abortActiveStream).toHaveBeenCalledWith(expect.any(Error));
    expect(mockScheduleToolCalls).not.toHaveBeenCalled();
    expect(setLastGeminiActivityTime).toHaveBeenCalled();
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gemini',
        text: 'Partial output',
      }),
      123,
    );
    expect(setPendingHistoryItem).toHaveBeenCalledWith(null);
    expect(setThought).toHaveBeenCalledWith(null);
    expect(mockAddItem).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.ERROR }),
      expect.any(Number),
    );
  });

  it('does not leave idle-timeout timers behind while rapidly consuming stream events', async () => {
    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    setPendingHistoryItem = vi.fn();
    const thinkingBlocksRef = { current: [] as ThinkingBlock[] };
    const turnCancelledRef = { current: false };
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const loopDetectedRef = { current: false };
    const lastProfileNameRef = { current: undefined as string | undefined };

    const { result } = renderHook(() =>
      useStreamEventHandlers({
        config: mockConfig,
        settings: mockSettings,
        addItem: mockAddItem,
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: vi.fn(),
        pendingHistoryItemRef,
        thinkingBlocksRef,
        turnCancelledRef,
        queuedSubmissionsRef,
        setPendingHistoryItem,
        setIsResponding: vi.fn(),
        setThought,
        setLastGeminiActivityTime,
        scheduleToolCalls: mockScheduleToolCalls,
        abortActiveStream,
        handleShellCommand: vi.fn(() => false),
        handleSlashCommand: vi.fn().mockResolvedValue(false),
        logger: null,
        shellModeActive: false,
        loopDetectedRef,
        lastProfileNameRef,
      }),
    );

    const signalController = new AbortController();
    const fastStream =
      (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'One',
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Two',
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Three',
        };
      })();

    await result.current.processGeminiStreamEvents(
      fastStream,
      456,
      signalController.signal,
    );

    expect(vi.getTimerCount()).toBe(0);
    expect(abortActiveStream).not.toHaveBeenCalled();
    expect(mockScheduleToolCalls).not.toHaveBeenCalled();
    expect(setThought).not.toHaveBeenCalledWith(null);
    expect(mockAddItem).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.ERROR }),
      expect.any(Number),
    );
  });
});
