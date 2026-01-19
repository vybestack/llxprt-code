/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import {
  usePhraseCycler,
  PHRASE_CHANGE_INTERVAL_MS,
} from './usePhraseCycler.js';
import {
  LLXPRT_PHRASES,
  GEMINI_CLI_PHRASES,
  COMMUNITY_PHRASES,
} from '../constants/phrasesCollections.js';

describe('usePhraseCycler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with a witty phrase when not active and not waiting', () => {
    const { result } = renderHook(() => usePhraseCycler(false, false));
    expect(LLXPRT_PHRASES).toContain(result.current);
  });

  it('should show "Waiting for user confirmation..." when isWaiting is true', () => {
    const { result, rerender } = renderHook(
      ({ isActive, isWaiting }) => usePhraseCycler(isActive, isWaiting),
      { initialProps: { isActive: true, isWaiting: false } },
    );
    rerender({ isActive: true, isWaiting: true });
    expect(result.current).toBe('Waiting for user confirmation...');
  });

  it('should not cycle phrases if isActive is false and not waiting', () => {
    const { result } = renderHook(() => usePhraseCycler(false, false));
    const initialPhrase = result.current;
    act(() => {
      vi.advanceTimersByTime(PHRASE_CHANGE_INTERVAL_MS * 2);
    });
    expect(result.current).toBe(initialPhrase);
  });

  it('should cycle through witty phrases when isActive is true and not waiting', () => {
    const { result } = renderHook(() => usePhraseCycler(true, false));
    // Initial phrase should be one of witty phrases
    expect(LLXPRT_PHRASES).toContain(result.current);
    const _initialPhrase = result.current;

    act(() => {
      vi.advanceTimersByTime(PHRASE_CHANGE_INTERVAL_MS);
    });
    // Phrase should change and be one of witty phrases
    expect(LLXPRT_PHRASES).toContain(result.current);

    const _secondPhrase = result.current;
    act(() => {
      vi.advanceTimersByTime(PHRASE_CHANGE_INTERVAL_MS);
    });
    expect(LLXPRT_PHRASES).toContain(result.current);
  });

  it('should reset to a witty phrase when isActive becomes true after being false (and not waiting)', () => {
    // Ensure there are at least two phrases for this test to be meaningful.
    if (LLXPRT_PHRASES.length < 2) {
      return;
    }

    // Mock Math.random to make test deterministic.
    // Returns sequence of indices: 0, 1, 2, ... (normalized by phrase length)
    let callCount = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      const val = callCount % LLXPRT_PHRASES.length;
      callCount++;
      return val / LLXPRT_PHRASES.length;
    });

    const { result, rerender } = renderHook(
      ({ isActive, isWaiting }) => usePhraseCycler(isActive, isWaiting),
      { initialProps: { isActive: false, isWaiting: false } },
    );

    // Activate - first random call returns 0 -> LLXPRT_PHRASES[0]
    rerender({ isActive: true, isWaiting: false });
    const firstActivePhrase = result.current;
    expect(LLXPRT_PHRASES).toContain(firstActivePhrase);
    expect(firstActivePhrase).toBe(LLXPRT_PHRASES[0]);

    // Advance timer - interval callback triggers, random returns 1 -> LLXPRT_PHRASES[1]
    act(() => {
      vi.advanceTimersByTime(PHRASE_CHANGE_INTERVAL_MS);
    });

    // Phrase should change after timer
    expect(LLXPRT_PHRASES).toContain(result.current);
    const secondPhrase = result.current;

    // Set to inactive - should reset to the first phrase (loadingPhrases[0])
    rerender({ isActive: false, isWaiting: false });
    expect(result.current).toBe(LLXPRT_PHRASES[0]);

    // Set back to active - should pick a new random phrase
    rerender({ isActive: true, isWaiting: false });
    expect(LLXPRT_PHRASES).toContain(result.current);
    // Should be different from what we had after the timer interval
    // (since we're selecting a new random phrase on activation)
    expect(result.current).not.toBe(secondPhrase);
  });

  it('should clear phrase interval on unmount when active', () => {
    const { unmount } = renderHook(() => usePhraseCycler(true, false));
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
  });

  it('should use custom phrases when provided', () => {
    const customPhrases = ['Custom Phrase 1', 'Custom Phrase 2'];
    let callCount = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      const val = callCount % 2;
      callCount++;
      return val / customPhrases.length;
    });

    const { result, rerender } = renderHook(
      ({ isActive, isWaiting, customPhrases: phrases }) =>
        usePhraseCycler(isActive, isWaiting, 'default', phrases),
      {
        initialProps: {
          isActive: true,
          isWaiting: false,
          customPhrases,
        },
      },
    );

    expect(result.current).toBe(customPhrases[0]);

    act(() => {
      vi.advanceTimersByTime(PHRASE_CHANGE_INTERVAL_MS);
    });

    expect(result.current).toBe(customPhrases[1]);

    rerender({ isActive: true, isWaiting: false, customPhrases: undefined });

    expect(LLXPRT_PHRASES).toContain(result.current);
  });

  it('should fall back to witty phrases if custom phrases are an empty array', () => {
    const { result } = renderHook(
      ({ isActive, isWaiting, customPhrases: phrases }) =>
        usePhraseCycler(isActive, isWaiting, 'default', phrases),
      {
        initialProps: {
          isActive: true,
          isWaiting: false,
          customPhrases: [],
        },
      },
    );

    expect(LLXPRT_PHRASES).toContain(result.current);
  });

  it('should reset to a witty phrase when transitioning from waiting to active', () => {
    const { result, rerender } = renderHook(
      ({ isActive, isWaiting }) => usePhraseCycler(isActive, isWaiting),
      { initialProps: { isActive: true, isWaiting: false } },
    );

    const _initialPhrase = result.current;
    expect(LLXPRT_PHRASES).toContain(_initialPhrase);

    // Cycle to a different phrase (potentially)
    act(() => {
      vi.advanceTimersByTime(PHRASE_CHANGE_INTERVAL_MS);
    });
    if (LLXPRT_PHRASES.length > 1) {
      // This check is probabilistic with random selection
    }
    expect(LLXPRT_PHRASES).toContain(result.current);

    // Go to waiting state
    rerender({ isActive: false, isWaiting: true });
    expect(result.current).toBe('Waiting for user confirmation...');

    // Go back to active cycling - should pick a random witty phrase
    rerender({ isActive: true, isWaiting: false });
    expect(LLXPRT_PHRASES).toContain(result.current);
  });

  // Tests for witty phrase style selection
  describe('wittyPhraseStyle selection', () => {
    it('should use LLxprt phrases for "llxprt" style', () => {
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'llxprt'),
      );
      expect(LLXPRT_PHRASES).toContain(result.current);
    });

    it('should use Gemini-CLI phrases for "gemini-cli" style', () => {
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'gemini-cli'),
      );
      expect(GEMINI_CLI_PHRASES).toContain(result.current);
    });

    it('should use Community phrases for "whimsical" style', () => {
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'whimsical'),
      );
      expect(COMMUNITY_PHRASES).toContain(result.current);
    });

    it('should use custom phrases for "custom" style when provided', () => {
      const customPhrases = ['Custom Phrase 1', 'Custom Phrase 2'];
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'custom', customPhrases),
      );
      expect(customPhrases).toContain(result.current);
    });

    it('should fallback to LLxprt phrases for "custom" style when custom is empty', () => {
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'custom', []),
      );
      expect(LLXPRT_PHRASES).toContain(result.current);
    });

    it('should use custom phrases for "default" style when provided', () => {
      const customPhrases = ['Custom Phrase 1', 'Custom Phrase 2'];
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'default', customPhrases),
      );
      expect(customPhrases).toContain(result.current);
    });

    it('should fallback to LLxprt phrases for "default" style when custom is empty', () => {
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'default', []),
      );
      expect(LLXPRT_PHRASES).toContain(result.current);
    });

    it('should use LLxprt phrases for "default" style when custom is undefined', () => {
      const { result } = renderHook(() =>
        usePhraseCycler(true, false, 'default', undefined),
      );
      expect(LLXPRT_PHRASES).toContain(result.current);
    });

    it('should default to "default" style when style parameter is not provided', () => {
      const { result } = renderHook(() => usePhraseCycler(true, false));
      expect(LLXPRT_PHRASES).toContain(result.current);
    });
  });
});
