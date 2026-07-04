/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2329: the Finished-event handler must surface a
 * refusal-specific notice when the raw provider stop reason is 'refusal'
 * (Claude Fable 5 safety-classifier refusals arrive as HTTP 200 with
 * stop_reason 'refusal'), and must stay silent for normal completions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { FinishReason } from '@google/genai';
import type {
  Config,
  ServerFinishedEvent,
  AgentEventType,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../test-utils/render.js';
import { useStreamEventHandlers } from '../useStreamEventHandlers.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import type { QueuedSubmission } from '../types.js';

describe('useFinishedEventHandler — refusal notice (issue #2329)', () => {
  const mockConfig = {
    getModel: vi.fn(() => 'claude-fable-5'),
    getMaxSessionTurns: vi.fn(() => 42),
    getEphemeralSetting: vi.fn(() => undefined),
    getSettingsService: vi.fn(() => ({
      get: vi.fn(() => null),
      getCurrentProfileName: vi.fn(() => null),
    })),
  } as unknown as Config;

  const mockSettings = {
    merged: { ui: {} },
  } as unknown as LoadedSettings;

  let mockAddItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAddItem = vi.fn();
  });

  function renderHandlers() {
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
        lastProfileNameRef: { current: undefined },
        lastModelInfoRef: { current: null },
        lastModelIdentityRef: { current: null },
      }),
    );
    return result;
  }

  function makeFinishedEvent(
    reason: FinishReason,
    stopReason?: string,
  ): ServerFinishedEvent {
    return {
      type: 'finished' as AgentEventType.Finished,
      value: {
        reason,
        ...(stopReason !== undefined ? { stopReason } : {}),
      },
    };
  }

  it('adds a refusal notice info item when stopReason is "refusal"', () => {
    const result = renderHandlers();

    result.current.handleFinishedEvent(
      makeFinishedEvent(FinishReason.STOP, 'refusal'),
      1000,
    );

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    const [item, timestamp] = mockAddItem.mock.calls[0];
    expect(item.type).toBe('info');
    expect(item.text).toContain('safety classifier refused');
    expect(item.text).toContain('Try rephrasing');
    expect(timestamp).toBe(1000);
  });

  it('prefers the refusal notice over the generic SAFETY message', () => {
    const result = renderHandlers();

    result.current.handleFinishedEvent(
      makeFinishedEvent(FinishReason.SAFETY, 'refusal'),
      1000,
    );

    const [item] = mockAddItem.mock.calls[0];
    expect(item.text).not.toContain('Response stopped due to safety reasons');
  });

  it('falls back to the generic message for SAFETY without a refusal stopReason', () => {
    const result = renderHandlers();

    result.current.handleFinishedEvent(
      makeFinishedEvent(FinishReason.SAFETY),
      2000,
    );

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    const [item] = mockAddItem.mock.calls[0];
    expect(item.type).toBe('info');
    expect(item.text).toContain('Response stopped due to safety reasons');
  });

  it('adds no item for a normal STOP completion', () => {
    const result = renderHandlers();

    result.current.handleFinishedEvent(
      makeFinishedEvent(FinishReason.STOP, 'end_turn'),
      3000,
    );

    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('adds no item for a STOP completion without any stopReason', () => {
    const result = renderHandlers();

    result.current.handleFinishedEvent(
      makeFinishedEvent(FinishReason.STOP),
      4000,
    );

    expect(mockAddItem).not.toHaveBeenCalled();
  });
});
