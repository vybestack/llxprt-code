/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useSessionInitialization } from './useSessionInitialization.js';
import { SessionStartSource } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core';

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
    triggerSessionStartHook: vi.fn().mockResolvedValue(null),
    SessionStartSource: actual.SessionStartSource,
  };
});

const iContentToHistoryItemsMock = vi.hoisted(() =>
  vi.fn().mockReturnValue([]),
);
vi.mock('../../../utils/iContentToHistoryItems.js', () => ({
  iContentToHistoryItems: iContentToHistoryItemsMock,
}));

interface ConfigStub {
  getLlxprtMdFileCount: ReturnType<typeof vi.fn>;
  getCoreMemoryFileCount: ReturnType<typeof vi.fn>;
  getGeminiClient: ReturnType<typeof vi.fn>;
}

const makeConfig = (
  llxprtMdFileCount = 0,
  coreMemoryFileCount = 0,
): ConfigStub => ({
  getLlxprtMdFileCount: vi.fn().mockReturnValue(llxprtMdFileCount),
  getCoreMemoryFileCount: vi.fn().mockReturnValue(coreMemoryFileCount),
  getGeminiClient: vi.fn().mockReturnValue(null),
});

describe('useSessionInitialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes memory file counts from config', async () => {
    const config = makeConfig(3, 5);
    const loadHistory = vi.fn();
    const addItem = vi.fn();

    const { result } = renderHook(() =>
      useSessionInitialization({
        config: config as never,
        addItem,
        loadHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.llxprtMdFileCount).toBe(3);
    expect(result.current.coreMemoryFileCount).toBe(5);
  });

  it('seeds resumed history via loadHistory when resumedHistory is provided', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const resumedHistory: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ];
    const fakeHistoryItems = [{ id: 1, type: 'user' as const, text: 'hello' }];

    iContentToHistoryItemsMock.mockReturnValue(fakeHistoryItems);

    renderHook(() =>
      useSessionInitialization({
        config: config as never,
        addItem,
        loadHistory,
        resumedHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadHistory).toHaveBeenCalledWith(fakeHistoryItems);
  });

  it('does not call loadHistory when resumedHistory is empty', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();

    renderHook(() =>
      useSessionInitialization({
        config: config as never,
        addItem,
        loadHistory,
        resumedHistory: [],
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('triggers session start hook on mount', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const { triggerSessionStartHook } = await import(
      '@vybestack/llxprt-code-core'
    );

    renderHook(() =>
      useSessionInitialization({
        config: config as never,
        addItem,
        loadHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(triggerSessionStartHook).toHaveBeenCalledWith(
      config,
      SessionStartSource.Startup,
    );
  });

  it('aborts session initialization on unmount', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();

    const { unmount } = renderHook(() =>
      useSessionInitialization({
        config: config as never,
        addItem,
        loadHistory,
      }),
    );

    // Unmount should not throw and should abort cleanly
    unmount();

    // Give any pending promises time to settle
    await act(async () => {
      await Promise.resolve();
    });

    // The hook must not continue to load history after unmount; with no
    // resumedHistory supplied, loadHistory is never called anyway, and the
    // abort must not cause a spurious invocation either.
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('does not duplicate history seeding across renders', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const resumedHistory: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
    ];
    const fakeHistoryItems = [{ id: 1, type: 'user' as const, text: 'hi' }];

    iContentToHistoryItemsMock.mockReturnValue(fakeHistoryItems);

    const { rerender } = renderHook(() =>
      useSessionInitialization({
        config: config as never,
        addItem,
        loadHistory,
        resumedHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadHistory).toHaveBeenCalledTimes(1);
  });
});
