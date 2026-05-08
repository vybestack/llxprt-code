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
  const testTimeoutMs = 30_000; // 30 second timeout for watchdog tests

  const mockConfig = {
    getModel: vi.fn(() => 'gemini-2.5-pro'),
    getMaxSessionTurns: vi.fn(() => 42),
    getEphemeralSetting: vi.fn((key: string) => {
      if (key === 'stream-idle-timeout-ms') {
        return testTimeoutMs;
      }
      return undefined;
    }),
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

    await vi.advanceTimersByTimeAsync(testTimeoutMs + 1);

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

  it('flushes pending gemini content when AgentExecutionStopped clears context mid-stream', async () => {
    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    const flushedItems: HistoryItemWithoutId[] = [];
    const flushPendingHistoryItem = vi.fn(() => {
      if (pendingHistoryItemRef.current) {
        flushedItems.push(pendingHistoryItemRef.current);
      }
    });
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
        flushPendingHistoryItem,
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
    const stream =
      (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Before clear',
        };
        yield {
          type: ServerGeminiEventType.AgentExecutionStopped,
          reason: 'Hook stopped execution',
          contextCleared: true,
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'After clear',
        };
      })();

    await result.current.processGeminiStreamEvents(
      stream,
      789,
      signalController.signal,
    );

    expect(flushPendingHistoryItem).toHaveBeenCalledTimes(1);
    expect(flushedItems[0]).toMatchObject({
      type: 'gemini',
      text: 'Before clear',
    });
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Execution stopped by hook: Hook stopped execution',
      }),
      789,
    );
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      }),
      789,
    );
    expect(pendingHistoryItemRef.current).toMatchObject({
      type: 'gemini',
      text: 'After clear',
    });
    expect(pendingHistoryItemRef.current).not.toMatchObject({
      text: 'Before clearAfter clear',
    });
  });

  it('flushes pending gemini content when AgentExecutionBlocked clears context mid-stream', async () => {
    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    const flushedItems: HistoryItemWithoutId[] = [];
    const flushPendingHistoryItem = vi.fn(() => {
      if (pendingHistoryItemRef.current) {
        flushedItems.push(pendingHistoryItemRef.current);
      }
    });
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
        flushPendingHistoryItem,
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
    const stream =
      (async function* (): AsyncGenerator<ServerGeminiStreamEvent> {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Before block clear',
        };
        yield {
          type: ServerGeminiEventType.AgentExecutionBlocked,
          reason: 'Hook blocked execution',
          contextCleared: true,
        };
        yield {
          type: ServerGeminiEventType.Content,
          value: 'After block clear',
        };
      })();

    await result.current.processGeminiStreamEvents(
      stream,
      790,
      signalController.signal,
    );

    expect(flushPendingHistoryItem).toHaveBeenCalledTimes(1);
    expect(flushedItems[0]).toMatchObject({
      type: 'gemini',
      text: 'Before block clear',
    });
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Execution blocked by hook: Hook blocked execution',
      }),
      790,
    );
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      }),
      790,
    );
    expect(pendingHistoryItemRef.current).toMatchObject({
      type: 'gemini',
      text: 'After block clear',
    });
    expect(pendingHistoryItemRef.current).not.toMatchObject({
      text: 'Before block clearAfter block clear',
    });
  });
});

describe('useStreamEventHandlers stream idle timeout behavioral tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('honors config setting: timeout fires after custom timeout from config.getEphemeralSetting', async () => {
    const customTimeoutMs = 25_000; // 25 seconds

    const mockConfigWithTimeout = {
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getMaxSessionTurns: vi.fn(() => 42),
      getEphemeralSetting: vi.fn((key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return customTimeoutMs;
        }
        return undefined;
      }),
    } as unknown as Config;

    const mockSettings = {
      merged: { ui: { showCitations: false } },
    } as LoadedSettings;

    const mockAddItem = vi.fn();
    const mockScheduleToolCalls = vi.fn().mockResolvedValue(undefined);
    const abortActiveStream = vi.fn();
    const setThought = vi.fn();
    const setLastGeminiActivityTime = vi.fn();

    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    const setPendingHistoryItem = vi.fn((value) => {
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
        config: mockConfigWithTimeout,
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
        await new Promise(() => {}); // Stalled
      })();

    const runPromise = result.current.processGeminiStreamEvents(
      stalledStream,
      123,
      signalController.signal,
    );

    // Attach rejection handler before advancing timers to prevent unhandled rejection
    const runRejection = runPromise.then(
      () => {
        throw new Error('Expected stalled stream to timeout');
      },
      (error) => {
        expect(error).toMatchObject({
          name: 'StreamIdleTimeoutError',
        });
      },
    );

    // Advance just under custom timeout - no timeout
    await vi.advanceTimersByTimeAsync(24_999);
    await Promise.resolve();
    expect(abortActiveStream).not.toHaveBeenCalled();

    // Advance past custom timeout
    await vi.advanceTimersByTimeAsync(2);
    await Promise.resolve();

    await vi.runAllTimersAsync();
    await runRejection;

    expect(abortActiveStream).toHaveBeenCalledWith(expect.any(Error));
  });

  it('disabled path: no timeout when setting is 0, even after extended period', async () => {
    const mockConfigWithTimeout = {
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getMaxSessionTurns: vi.fn(() => 42),
      getEphemeralSetting: vi.fn((key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return 0; // Disabled
        }
        return undefined;
      }),
    } as unknown as Config;

    const mockSettings = {
      merged: { ui: { showCitations: false } },
    } as LoadedSettings;

    const mockAddItem = vi.fn();
    const mockScheduleToolCalls = vi.fn().mockResolvedValue(undefined);
    const abortActiveStream = vi.fn();
    const setThought = vi.fn();
    const setLastGeminiActivityTime = vi.fn();

    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    const setPendingHistoryItem = vi.fn();
    const thinkingBlocksRef = { current: [] as ThinkingBlock[] };
    const turnCancelledRef = { current: false };
    const queuedSubmissionsRef = { current: [] as QueuedSubmission[] };
    const loopDetectedRef = { current: false };
    const lastProfileNameRef = { current: undefined as string | undefined };

    let resolveIterator: () => void;
    const iteratorPromise = new Promise<void>((resolve) => {
      resolveIterator = resolve;
    });

    const { result } = renderHook(() =>
      useStreamEventHandlers({
        config: mockConfigWithTimeout,
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
          value: 'Starting...',
        };
        await iteratorPromise; // Stalled until manually resolved
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Finally done',
        };
      })();

    const runPromise = result.current.processGeminiStreamEvents(
      stalledStream,
      123,
      signalController.signal,
    );

    // Advance 30 minutes - no timeout because watchdog disabled
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await Promise.resolve();

    // No timeout
    expect(abortActiveStream).not.toHaveBeenCalled();

    // Resolve the iterator to let the test complete
    resolveIterator!();
    await vi.runAllTimersAsync();
    await runPromise;
  });

  it('env var precedence: env var overrides config setting', async () => {
    const envTimeoutMs = 15_000; // 15 seconds from env
    const configTimeoutMs = 60_000; // 60 seconds from config (ignored)

    process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

    const mockConfigWithTimeout = {
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getMaxSessionTurns: vi.fn(() => 42),
      getEphemeralSetting: vi.fn((key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return configTimeoutMs;
        }
        return undefined;
      }),
    } as unknown as Config;

    const mockSettings = {
      merged: { ui: { showCitations: false } },
    } as LoadedSettings;

    const mockAddItem = vi.fn();
    const mockScheduleToolCalls = vi.fn().mockResolvedValue(undefined);
    const abortActiveStream = vi.fn();
    const setThought = vi.fn();
    const setLastGeminiActivityTime = vi.fn();

    const pendingHistoryItemRef = {
      current: null as HistoryItemWithoutId | null,
    };
    const setPendingHistoryItem = vi.fn((value) => {
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
        config: mockConfigWithTimeout,
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
        await vi.advanceTimersByTimeAsync(30_000);
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Late response',
        };
      })();

    const runPromise = result.current.processGeminiStreamEvents(
      stalledStream,
      123,
      signalController.signal,
    );

    // Attach rejection handler before advancing timers to prevent unhandled rejection
    const runRejection = runPromise.then(
      () => {
        throw new Error('Expected stalled stream to timeout');
      },
      (error) => {
        expect(error).toMatchObject({
          name: 'StreamIdleTimeoutError',
        });
      },
    );

    // Advance past env timeout (15s) but before config timeout (60s)
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.resolve();

    await vi.runAllTimersAsync();
    await runRejection;

    // Should have timed out at env value (15s), not config (60s)
    expect(abortActiveStream).toHaveBeenCalledWith(expect.any(Error));
  });
});
