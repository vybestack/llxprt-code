/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, useEffect, useState, useCallback } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useCommandCompletion } from './useCommandCompletion.js';
import type { CommandContext } from '../commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import type { UseAtCompletionProps } from './useAtCompletion.js';
import { useAtCompletion } from './useAtCompletion.js';
import { useSlashCompletion } from './useSlashCompletion.js';

vi.mock('./useAtCompletion', () => ({
  useAtCompletion: vi.fn(),
}));

vi.mock('./useSlashCompletion');

vi.mock('./useCompletion', () => ({
  useCompletion: vi.fn(() => {
    const [suggestions, setSuggestions] = useState([]);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const [visibleStartIndex, setVisibleStartIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const [isPerfectMatch, setIsPerfectMatch] = useState(false);

    const resetCompletionState = useCallback(() => {
      setSuggestions([]);
      setActiveSuggestionIndex(-1);
      setVisibleStartIndex(0);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setIsPerfectMatch(false);
    }, []);

    const navigateUp = useCallback(() => {
      if (suggestions.length === 0) return;
      setActiveSuggestionIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
    }, [suggestions.length]);

    const navigateDown = useCallback(() => {
      if (suggestions.length === 0) return;
      setActiveSuggestionIndex((prev) =>
        prev >= suggestions.length - 1 ? 0 : prev + 1,
      );
    }, [suggestions.length]);

    // Auto-select first suggestion when suggestions change
    useEffect(() => {
      setActiveSuggestionIndex(suggestions.length > 0 ? 0 : -1);
      setShowSuggestions(suggestions.length > 0);
    }, [suggestions]);

    return {
      suggestions,
      activeSuggestionIndex,
      visibleStartIndex,
      showSuggestions,
      isLoadingSuggestions,
      isPerfectMatch,
      setSuggestions,
      setShowSuggestions,
      setActiveSuggestionIndex,
      setIsLoadingSuggestions,
      setIsPerfectMatch,
      setVisibleStartIndex,
      resetCompletionState,
      navigateUp,
      navigateDown,
    };
  }),
}));

vi.mock('./usePromptCompletion', () => ({
  usePromptCompletion: vi.fn(() => ({
    suggestions: [],
    activeSuggestionIndex: -1,
    visibleStartIndex: 0,
    showSuggestions: false,
    isLoadingSuggestions: false,
    setSuggestions: vi.fn(),
    setActiveSuggestionIndex: vi.fn(),
    setShowSuggestions: vi.fn(),
    resetCompletionState: vi.fn(),
    navigateUp: vi.fn(),
    navigateDown: vi.fn(),
    handleAutocomplete: vi.fn(),
    setVisibleStartIndex: vi.fn(),
  })),
  PROMPT_COMPLETION_MIN_LENGTH: 30,
}));

// Helper to set up mocks in a consistent way for both child hooks
const setupMocks = ({
  atSuggestions = [],
  slashSuggestions = [],
  isLoading = false,
  isPerfectMatch = false,
}: {
  atSuggestions?: Suggestion[];
  slashSuggestions?: Suggestion[];
  isLoading?: boolean;
  isPerfectMatch?: boolean;
}) => {
  // Mock for @-completions
  (useAtCompletion as vi.Mock).mockImplementation(
    ({
      enabled,
      setSuggestions,
      setIsLoadingSuggestions,
    }: UseAtCompletionProps) => {
      useEffect(() => {
        if (enabled) {
          setIsLoadingSuggestions(isLoading);
          setSuggestions(atSuggestions);
        }
      }, [enabled, setSuggestions, setIsLoadingSuggestions]);
    },
  );

  // Mock for /-completions with proper state management
  (useSlashCompletion as vi.Mock).mockImplementation((buffer) => {
    const [suggestions, setSuggestions] =
      useState<Suggestion[]>(slashSuggestions);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(
      slashSuggestions.length > 0 ? 0 : -1,
    );
    const [visibleStartIndex, setVisibleStartIndex] = useState<number>(0);
    const [showSuggestions, setShowSuggestions] = useState<boolean>(
      slashSuggestions.length > 0,
    );
    const [isLoadingSuggestions, setIsLoadingSuggestions] =
      useState<boolean>(isLoading);
    const [isPerfectMatchState, setIsPerfectMatch] =
      useState<boolean>(isPerfectMatch);

    const resetCompletionState = useCallback(() => {
      setSuggestions([]);
      setActiveSuggestionIndex(-1);
      setVisibleStartIndex(0);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setIsPerfectMatch(false);
    }, []);

    const navigateUp = useCallback(() => {
      if (suggestions.length === 0) return;
      setActiveSuggestionIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
    }, [suggestions.length]);

    const navigateDown = useCallback(() => {
      if (suggestions.length === 0) return;
      setActiveSuggestionIndex((prev) =>
        prev >= suggestions.length - 1 ? 0 : prev + 1,
      );
    }, [suggestions.length]);

    const handleAutocomplete = useCallback(
      (indexToUse: number) => {
        if (indexToUse < 0 || indexToUse >= suggestions.length) {
          return;
        }
        const suggestion = suggestions[indexToUse].value;
        // For slash commands, replace the entire line
        buffer.setText(`/${suggestion} `);
      },
      [suggestions, buffer],
    );

    return {
      suggestions,
      activeSuggestionIndex,
      visibleStartIndex,
      showSuggestions,
      isLoadingSuggestions,
      isPerfectMatch: isPerfectMatchState,
      setActiveSuggestionIndex,
      setShowSuggestions,
      resetCompletionState,
      navigateUp,
      navigateDown,
      handleAutocomplete,
    };
  });
};

describe('useCommandCompletion', () => {
  const mockCommandContext = {} as CommandContext;
  const mockConfig = {
    getEnablePromptCompletion: () => false,
    getAgentClient: vi.fn(),
    getWorkspaceContext: () => ({
      getDirectories: () => [],
    }),
  } as Config;
  const testRootDir = '/';

  // Helper to create real TextBuffer objects within renderHook
  function useTextBufferForTest(text: string, cursorOffset?: number) {
    return useTextBuffer({
      initialText: text,
      initialCursorOffset: cursorOffset ?? text.length,
      viewport: { width: 80, height: 20 },
      isValidPath: () => false,
      onChange: () => {},
    });
  }

  // Helper to render useCommandCompletion hook with text and cursor offset

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default mocks before each test
    setupMocks({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Core Hook Behavior', () => {
    describe('State Management', () => {
      it('should initialize with default state', () => {
        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest(''),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        expect(result.current.suggestions).toStrictEqual([]);
        expect(result.current.activeSuggestionIndex).toBe(-1);
        expect(result.current.visibleStartIndex).toBe(0);
        expect(result.current.showSuggestions).toBe(false);
        expect(result.current.isLoadingSuggestions).toBe(false);
      });

      it('should reset state when completion mode becomes IDLE', async () => {
        setupMocks({
          atSuggestions: [{ label: 'src/file.txt', value: 'src/file.txt' }],
        });

        const { result } = renderHook(() => {
          const textBuffer = useTextBufferForTest('@file');
          const completion = useCommandCompletion(
            textBuffer,
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          );
          return { completion, textBuffer };
        });

        await waitFor(() => {
          expect(result.current.completion.suggestions).toHaveLength(1);
        });

        expect(result.current.completion.showSuggestions).toBe(true);

        act(() => {
          result.current.textBuffer.replaceRangeByOffset(
            0,
            5,
            'just some text',
          );
        });

        await waitFor(() => {
          expect(result.current.completion.showSuggestions).toBe(false);
        });
      });

      it('should reset all state to default values', () => {
        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('@files'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        act(() => {
          result.current.setActiveSuggestionIndex(5);
          result.current.setShowSuggestions(true);
        });

        act(() => {
          result.current.resetCompletionState();
        });

        expect(result.current.activeSuggestionIndex).toBe(-1);
        expect(result.current.visibleStartIndex).toBe(0);
        expect(result.current.showSuggestions).toBe(false);
      });

      it('should call useAtCompletion with the correct query for an escaped space', async () => {
        const text = '@src/a\\ file.txt';
        renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest(text),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(useAtCompletion).toHaveBeenLastCalledWith(
            expect.objectContaining({
              enabled: true,
              pattern: 'src/a\\ file.txt',
            }),
          );
        });
      });

      it('should correctly identify the completion context with multiple @ symbols', async () => {
        const text = '@file1 @file2';
        const cursorOffset = 3; // @fi|le1 @file2

        renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest(text, cursorOffset),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(useAtCompletion).toHaveBeenLastCalledWith(
            expect.objectContaining({
              enabled: true,
              pattern: 'file1',
            }),
          );
        });
      });

      it.each([
        {
          shellModeActive: false,
          expectedSuggestions: 1,
          expectedShowSuggestions: true,
          description:
            'should show slash command suggestions when shellModeActive is false',
        },
        {
          shellModeActive: true,
          expectedSuggestions: 1,
          expectedShowSuggestions: true,
          description:
            'should show slash command suggestions when shellModeActive is true',
        },
      ])(
        '$description',
        async ({
          shellModeActive,
          expectedSuggestions,
          expectedShowSuggestions,
        }) => {
          setupMocks({
            slashSuggestions: [{ label: 'clear', value: 'clear' }],
          });

          const { result } = renderHook(() => {
            const textBuffer = useTextBufferForTest('/');
            const completion = useCommandCompletion(
              textBuffer,
              testRootDir,
              [],
              mockCommandContext,
              false,
              shellModeActive, // Parameterized shellModeActive
              mockConfig,
            );
            return { ...completion, textBuffer };
          });

          await waitFor(() => {
            expect(result.current.suggestions.length).toBe(expectedSuggestions);
            expect(result.current.showSuggestions).toBe(
              expectedShowSuggestions,
            );
          });

          act(() => {
            result.current.resetCompletionState();
          });
        },
      );
    });

    describe('Navigation', () => {
      const mockSuggestions = [
        { label: 'cmd1', value: 'cmd1' },
        { label: 'cmd2', value: 'cmd2' },
        { label: 'cmd3', value: 'cmd3' },
        { label: 'cmd4', value: 'cmd4' },
        { label: 'cmd5', value: 'cmd5' },
      ];

      beforeEach(() => {
        setupMocks({ slashSuggestions: mockSuggestions });
      });

      it('should handle navigateUp with no suggestions', () => {
        setupMocks({ slashSuggestions: [] });

        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('/'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        act(() => {
          result.current.navigateUp();
        });

        expect(result.current.activeSuggestionIndex).toBe(-1);
      });

      it('should handle navigateDown with no suggestions', () => {
        setupMocks({ slashSuggestions: [] });
        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('/'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        act(() => {
          result.current.navigateDown();
        });

        expect(result.current.activeSuggestionIndex).toBe(-1);
      });

      it('should navigate up through suggestions with wrap-around', async () => {
        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('/'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions.length).toBe(5);
        });

        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => {
          result.current.navigateUp();
        });

        expect(result.current.activeSuggestionIndex).toBe(4);
      });

      it('should navigate down through suggestions with wrap-around', async () => {
        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('/'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions.length).toBe(5);
        });

        act(() => {
          result.current.setActiveSuggestionIndex(4);
        });
        expect(result.current.activeSuggestionIndex).toBe(4);

        act(() => {
          result.current.navigateDown();
        });

        expect(result.current.activeSuggestionIndex).toBe(0);
      });

      it('should handle navigation with multiple suggestions', async () => {
        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('/'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions.length).toBe(5);
        });

        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => result.current.navigateDown());
        expect(result.current.activeSuggestionIndex).toBe(1);

        act(() => result.current.navigateDown());
        expect(result.current.activeSuggestionIndex).toBe(2);

        act(() => result.current.navigateUp());
        expect(result.current.activeSuggestionIndex).toBe(1);

        act(() => result.current.navigateUp());
        expect(result.current.activeSuggestionIndex).toBe(0);

        act(() => result.current.navigateUp());
        expect(result.current.activeSuggestionIndex).toBe(4);
      });

      it('should automatically select the first item when suggestions are available', async () => {
        setupMocks({ slashSuggestions: mockSuggestions });

        const { result } = renderHook(() =>
          useCommandCompletion(
            useTextBufferForTest('/'),
            testRootDir,
            [],
            mockCommandContext,
            false,
            false,
            mockConfig,
          ),
        );

        await waitFor(() => {
          expect(result.current.suggestions.length).toBe(
            mockSuggestions.length,
          );
          expect(result.current.activeSuggestionIndex).toBe(0);
        });
      });
    });
  });
});
