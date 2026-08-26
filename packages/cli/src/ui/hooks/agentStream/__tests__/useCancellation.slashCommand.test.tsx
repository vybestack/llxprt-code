/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving that cancelOngoingRequest (ESC) cancels an in-flight
 * slash command even though a slash command never puts the stream into
 * Responding (issue #2976). A REAL useSlashCommandCancellation registry drives
 * the abort, so the assertions are on actual AbortSignal state and on the
 * history items the handler produced.
 */

import { describe, it, expect, vi } from 'bun:test';
import React, { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { createSlashCommandCancellation } from '../../useSlashCommandCancellation.js';
import {
  useCancellation,
  SLASH_COMMAND_CANCELLED,
} from '../useAgentStreamLifecycle.js';
import { StreamingState, MessageType } from '../../../types.js';
import { KeypressProvider } from '../../../contexts/KeypressContext.js';
import type { HistoryItemWithoutId } from '../../../types.js';

interface Harness {
  addedItems: HistoryItemWithoutId[];
  setTurnCancelled: ReturnType<typeof vi.fn>;
  turnAbortController: AbortController;
  beginSlashCommandAction: () => AbortController;
  pressEscape: () => void;
}

function renderHarness(streamingState: StreamingState): Harness {
  const addedItems: HistoryItemWithoutId[] = [];
  const setTurnCancelled = vi.fn();
  const turnAbortController = new AbortController();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  const cancellation = createSlashCommandCancellation();
  const { result } = renderHook(
    () => {
      const { cancelOngoingRequest } = useCancellation(
        streamingState,
        { current: false },
        setTurnCancelled,
        { current: turnAbortController },
        () => {}, // cancelAllToolCalls
        { current: null },
        () => {}, // flushPendingHistoryItem
        (item: HistoryItemWithoutId) => {
          addedItems.push(item);
          return addedItems.length;
        },
        () => {}, // setPendingHistoryItem
        () => {}, // onCancelSubmit
        () => {}, // setIsResponding
        () => {}, // setShellInputFocused
        { current: false }, // drainSuppressedRef
        () => {}, // cancelRunningAsyncTasks
        cancellation.cancelActiveSlashCommand,
      );
      return { cancelOngoingRequest };
    },
    { wrapper },
  );

  return {
    addedItems,
    setTurnCancelled,
    turnAbortController,
    beginSlashCommandAction: () => cancellation.beginSlashCommandAction(),
    pressEscape: () => {
      act(() => {
        result.current.cancelOngoingRequest();
      });
    },
  };
}

function cancellationNotices(items: HistoryItemWithoutId[]): string[] {
  return items
    .filter(
      (item): item is HistoryItemWithoutId & { text: string } =>
        item.type === MessageType.INFO && 'text' in item,
    )
    .map((item) => item.text)
    .filter((text) => text === SLASH_COMMAND_CANCELLED);
}

describe('useCancellation — slash-command cancellation on ESC', () => {
  it('aborts the in-flight slash command while the stream is Idle', () => {
    const harness = renderHarness(StreamingState.Idle);
    const controller = harness.beginSlashCommandAction();

    expect(controller.signal.aborted).toBe(false);
    harness.pressEscape();

    expect(controller.signal.aborted).toBe(true);
    expect(cancellationNotices(harness.addedItems)).toEqual([
      SLASH_COMMAND_CANCELLED,
    ]);
  });

  it('reports the cancellation only once when ESC is pressed repeatedly', () => {
    const harness = renderHarness(StreamingState.Idle);
    harness.beginSlashCommandAction();

    harness.pressEscape();
    harness.pressEscape();
    harness.pressEscape();

    expect(cancellationNotices(harness.addedItems)).toEqual([
      SLASH_COMMAND_CANCELLED,
    ]);
  });

  it('leaves an idle session untouched when no slash command is in flight', () => {
    const harness = renderHarness(StreamingState.Idle);

    harness.pressEscape();

    expect(harness.addedItems).toEqual([]);
    expect(harness.setTurnCancelled).not.toHaveBeenCalled();
    expect(harness.turnAbortController.signal.aborted).toBe(false);
  });

  it('still cancels the turn when a slash command is in flight during a response', () => {
    const harness = renderHarness(StreamingState.Responding);
    const controller = harness.beginSlashCommandAction();

    harness.pressEscape();

    expect(controller.signal.aborted).toBe(true);
    expect(harness.turnAbortController.signal.aborted).toBe(true);
    expect(harness.setTurnCancelled).toHaveBeenCalledWith(true);
  });
});
