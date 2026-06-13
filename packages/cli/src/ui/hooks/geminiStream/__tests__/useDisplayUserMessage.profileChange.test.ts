/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the consolidated inline notification path (issue #1770).
 *
 * The old useDisplayUserMessage path emitted profile_change history items
 * when the active profile differed from lastProfileNameRef. This created
 * duplicate notifications alongside the ModelInfo event path.
 *
 * ModelInfo (streamEventDispatcher.handleModelInfoEvent) is now the single
 * inline notification owner. useDisplayUserMessage must only add the USER
 * message and track lastProfileNameRef — it must NOT add profile_change items.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../test-utils/render.js';
import { useStreamEventHandlers } from '../useStreamEventHandlers.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';

describe('useDisplayUserMessage — consolidated profile_change path (issue #1770)', () => {
  const mockConfig = {
    getModel: vi.fn(() => 'gpt-4o'),
    getMaxSessionTurns: vi.fn(() => 42),
    getEphemeralSetting: vi.fn(() => undefined),
    getSettingsService: vi.fn(() => ({
      get: vi.fn(() => null),
      getCurrentProfileName: vi.fn(() => 'work'),
    })),
  } as unknown as Config;

  const mockSettings = {
    merged: { showProfileChangeInChat: true },
  } as unknown as LoadedSettings;

  let mockAddItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAddItem = vi.fn();
  });

  function renderHandlerWithRefs(overrides?: {
    lastProfileNameRef?: React.MutableRefObject<string | undefined>;
  }) {
    const lastProfileNameRef = overrides?.lastProfileNameRef ?? {
      current: 'old-profile' as string | undefined,
    };
    const { result } = renderHook(() =>
      useStreamEventHandlers({
        config: mockConfig,
        settings: mockSettings,
        addItem: mockAddItem,
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: vi.fn(),
        pendingHistoryItemRef: {
          current: null,
        } as React.MutableRefObject<HistoryItemWithoutId | null>,
        thinkingBlocksRef: { current: [] },
        turnCancelledRef: { current: false },
        queuedSubmissionsRef: { current: [] as QueuedSubmission[] },
        setPendingHistoryItem: vi.fn(),
        setIsResponding: vi.fn(),
        setThought: vi.fn(),
        setLastGeminiActivityTime: vi.fn(),
        scheduleToolCalls: vi.fn().mockResolvedValue(undefined),
        abortActiveStream: vi.fn(),
        handleShellCommand: vi.fn(() => false),
        handleSlashCommand: vi.fn().mockResolvedValue(false),
        logger: null,
        shellModeActive: false,
        loopDetectedRef: { current: false },
        lastProfileNameRef,
        lastModelInfoRef: { current: null },
        lastModelIdentityRef: { current: null },
      }),
    );
    return { result, lastProfileNameRef };
  }

  it('does not emit profile_change from useDisplayUserMessage even when profile differs', () => {
    // lastProfileNameRef starts as 'old-profile', live profile is 'work'
    const { result } = renderHandlerWithRefs({
      lastProfileNameRef: { current: 'old-profile' },
    });

    result.current.displayUserMessage('Hello', 1000);

    // Only the USER message should be added — no profile_change item
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem.mock.calls[0][0]).toStrictEqual({
      type: 'user',
      text: 'Hello',
    });
  });

  it('adds only the user message even when showProfileChangeInChat is true', () => {
    const { result } = renderHandlerWithRefs({
      lastProfileNameRef: { current: 'previous' },
    });

    result.current.displayUserMessage('Test query', 2000);

    // Exactly one call — the user message only
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    const addedItem = mockAddItem.mock.calls[0][0];
    expect(addedItem.type).toBe('user');
    expect(addedItem.type).not.toBe('profile_change');
  });

  it('still tracks lastProfileNameRef for backward compatibility', () => {
    const lastProfileNameRef = { current: 'before' as string | undefined };
    const { result } = renderHandlerWithRefsWithRef(lastProfileNameRef);

    result.current.displayUserMessage('query', 3000);

    // Ref should be updated to the current profile name
    expect(lastProfileNameRef.current).toBe('work');
  });

  function renderHandlerWithRefsWithRef(
    lastProfileNameRef: React.MutableRefObject<string | undefined>,
  ) {
    const { result } = renderHook(() =>
      useStreamEventHandlers({
        config: mockConfig,
        settings: mockSettings,
        addItem: mockAddItem,
        onDebugMessage: vi.fn(),
        onCancelSubmit: vi.fn(),
        sanitizeContent: (text: string) => ({ text, blocked: false }),
        flushPendingHistoryItem: vi.fn(),
        pendingHistoryItemRef: {
          current: null,
        } as React.MutableRefObject<HistoryItemWithoutId | null>,
        thinkingBlocksRef: { current: [] },
        turnCancelledRef: { current: false },
        queuedSubmissionsRef: { current: [] as QueuedSubmission[] },
        setPendingHistoryItem: vi.fn(),
        setIsResponding: vi.fn(),
        setThought: vi.fn(),
        setLastGeminiActivityTime: vi.fn(),
        scheduleToolCalls: vi.fn().mockResolvedValue(undefined),
        abortActiveStream: vi.fn(),
        handleShellCommand: vi.fn(() => false),
        handleSlashCommand: vi.fn().mockResolvedValue(false),
        logger: null,
        shellModeActive: false,
        loopDetectedRef: { current: false },
        lastProfileNameRef,
        lastModelInfoRef: { current: null },
        lastModelIdentityRef: { current: null },
      }),
    );
    return { result };
  }
});
