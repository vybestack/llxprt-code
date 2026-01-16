/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { useLoadingIndicator } from './useLoadingIndicator.js';
import { StreamingState } from '../types.js';
import { PHRASE_CHANGE_INTERVAL_MS } from './usePhraseCycler.js';
import { LLXPRT_PHRASES } from '../constants/phrasesCollections.js';

describe('useLoadingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers(); // Restore real timers after each test
    act(() => vi.runOnlyPendingTimers);
  });

  it('should initialize with default values when Idle', () => {
    const { result } = renderHook(() =>
      useLoadingIndicator(StreamingState.Idle),
    );
    expect(result.current.elapsedTime).toBe(0);
    expect(LLXPRT_PHRASES).toContain(result.current.currentLoadingPhrase);
  });

  it('should reflect values when Responding', async () => {
    const { result } = renderHook(() =>
      useLoadingIndicator(StreamingState.Responding),
    );

    // Initial state before timers advance
    expect(result.current.elapsedTime).toBe(0);
    expect(LLXPRT_PHRASES).toContain(result.current.currentLoadingPhrase);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHRASE_CHANGE_INTERVAL_MS + 1);
    });

    // Phrase should cycle if PHRASE_CHANGE_INTERVAL_MS has passed
    expect(LLXPRT_PHRASES).toContain(result.current.currentLoadingPhrase);
  });

  it('should show waiting phrase and retain elapsedTime when WaitingForConfirmation', async () => {
    const { result, rerender } = renderHook(
      ({ streamingState }) => useLoadingIndicator(streamingState),
      { initialProps: { streamingState: StreamingState.Responding } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(result.current.elapsedTime).toBe(60);

    act(() => {
      rerender({ streamingState: StreamingState.WaitingForConfirmation });
    });

    expect(result.current.currentLoadingPhrase).toBe(
      'Waiting for user confirmation...',
    );
    expect(result.current.elapsedTime).toBe(60); // Elapsed time should be retained

    // Timer should not advance further
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.elapsedTime).toBe(60);
  });

  it('should reset elapsedTime and use a witty phrase when transitioning from WaitingForConfirmation to Responding', async () => {
    const { result, rerender } = renderHook(
      ({ streamingState }) => useLoadingIndicator(streamingState),
      { initialProps: { streamingState: StreamingState.Responding } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000); // 5s
    });
    expect(result.current.elapsedTime).toBe(5);

    act(() => {
      rerender({ streamingState: StreamingState.WaitingForConfirmation });
    });
    expect(result.current.elapsedTime).toBe(5);
    expect(result.current.currentLoadingPhrase).toBe(
      'Waiting for user confirmation...',
    );

    act(() => {
      rerender({ streamingState: StreamingState.Responding });
    });
    expect(result.current.elapsedTime).toBe(0); // Should reset
    expect(LLXPRT_PHRASES).toContain(result.current.currentLoadingPhrase);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.elapsedTime).toBe(1);
  });

  it('should reset timer and phrase when streamingState changes from Responding to Idle', async () => {
    const { result, rerender } = renderHook(
      ({ streamingState }) => useLoadingIndicator(streamingState),
      { initialProps: { streamingState: StreamingState.Responding } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000); // 10s
    });
    expect(result.current.elapsedTime).toBe(10);

    act(() => {
      rerender({ streamingState: StreamingState.Idle });
    });

    expect(result.current.elapsedTime).toBe(0);
    expect(LLXPRT_PHRASES).toContain(result.current.currentLoadingPhrase);

    // Timer should not advance
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.elapsedTime).toBe(0);
  });

  it('should use custom witty phrases when provided', async () => {
    const customPhrases = ['Custom phrase 1', 'Custom phrase 2'];
    const { result } = renderHook(() =>
      useLoadingIndicator(StreamingState.Responding, 'custom', customPhrases),
    );

    // Should use a custom phrase
    expect(customPhrases).toContain(result.current.currentLoadingPhrase);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHRASE_CHANGE_INTERVAL_MS + 1);
    });

    // Should still be using a custom phrase after change
    expect(customPhrases).toContain(result.current.currentLoadingPhrase);
  });
});
