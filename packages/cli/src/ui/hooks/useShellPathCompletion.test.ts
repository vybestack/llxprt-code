/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useShellPathCompletion } from './useShellPathCompletion.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import {
  createTmpDir,
  cleanupTmpDir,
  FileSystemStructure,
} from '@vybestack/llxprt-code-test-utils';

describe('useShellPathCompletion', () => {
  let testRootDir: string;

  function useTextBufferForTest(text: string) {
    return useTextBuffer({
      initialText: text,
      initialCursorOffset: text.length,
      viewport: { width: 80, height: 20 },
      isValidPath: () => false,
      onChange: () => {},
    });
  }

  beforeEach(async () => {
    const structure: FileSystemStructure = {
      subdir: {
        'nested.txt': '',
      },
      anotherDir: {},
      'file1.txt': '',
      'file2.txt': '',
    };
    testRootDir = await createTmpDir(structure);
  });

  afterEach(async () => {
    if (testRootDir) {
      await cleanupTmpDir(testRootDir);
    }
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => {
      const buffer = useTextBufferForTest('echo hello');
      return useShellPathCompletion(buffer, testRootDir, true, false);
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.showSuggestions).toBe(false);
  });

  describe('path detection', () => {
    it('should detect relative paths and show suggestions', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cat ./file');
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.showSuggestions).toBe(true);
    });

    it('should detect absolute paths and show suggestions', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest(`cat ${testRootDir}/file`);
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.showSuggestions).toBe(true);
    });

    it('should detect tokens containing / as path-like', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cat subdir/');
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.showSuggestions).toBe(true);
    });

    it('should not show suggestions for non-path tokens', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('echo hello');
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(result.current.showSuggestions).toBe(false);
      expect(result.current.suggestions.length).toBe(0);
    });

    it('should not show suggestions when shellModeActive is false', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('ls ./');
        return useShellPathCompletion(buffer, testRootDir, false, false);
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(result.current.showSuggestions).toBe(false);
    });

    it('should not show suggestions when reverseSearchActive is true', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('ls ./');
        return useShellPathCompletion(buffer, testRootDir, true, true);
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(result.current.showSuggestions).toBe(false);
    });
  });

  describe('suggestion state', () => {
    it('should auto-select first suggestion', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cat ./file');
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      expect(result.current.activeSuggestionIndex).toBe(0);
    });

    it('should reset state when shell mode deactivates', async () => {
      const { result, rerender } = renderHook(
        ({ shellActive }: { shellActive: boolean }) => {
          const buffer = useTextBufferForTest('cat ./file');
          return useShellPathCompletion(
            buffer,
            testRootDir,
            shellActive,
            false,
          );
        },
        { initialProps: { shellActive: true } },
      );

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      act(() => {
        rerender({ shellActive: false });
      });

      await waitFor(() => {
        expect(result.current.showSuggestions).toBe(false);
        expect(result.current.suggestions.length).toBe(0);
      });
    });
  });

  describe('navigation', () => {
    it('should navigate down through suggestions', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cat ./');
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(1);
      });

      expect(result.current.activeSuggestionIndex).toBe(0);

      act(() => {
        result.current.navigateDown();
      });

      expect(result.current.activeSuggestionIndex).toBe(1);
    });

    it('should navigate up with wrap-around', async () => {
      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cat ./');
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(1);
      });

      expect(result.current.activeSuggestionIndex).toBe(0);

      act(() => {
        result.current.navigateUp();
      });

      expect(result.current.activeSuggestionIndex).toBe(
        result.current.suggestions.length - 1,
      );
    });
  });

  describe('handleAutocomplete', () => {
    it('should replace path token with selected file (add trailing space)', async () => {
      const bufferRef: { current: ReturnType<typeof useTextBuffer> | null } = {
        current: null,
      };

      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cat ./file1');
        bufferRef.current = buffer;
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const fileIdx = result.current.suggestions.findIndex(
        (s) => s.value === './file1.txt',
      );
      expect(fileIdx).toBeGreaterThanOrEqual(0);

      act(() => {
        result.current.handleAutocomplete(fileIdx);
      });

      expect(bufferRef.current?.text).toBe('cat ./file1.txt ');
    });

    it('should replace path token with selected directory (no trailing space)', async () => {
      const bufferRef: { current: ReturnType<typeof useTextBuffer> | null } = {
        current: null,
      };

      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('ls ./sub');
        bufferRef.current = buffer;
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const dirIdx = result.current.suggestions.findIndex(
        (s) => s.value === './subdir/',
      );
      expect(dirIdx).toBeGreaterThanOrEqual(0);

      act(() => {
        result.current.handleAutocomplete(dirIdx);
      });

      expect(bufferRef.current?.text).toBe('ls ./subdir/');
    });

    it('should preserve text before the path token', async () => {
      const bufferRef: { current: ReturnType<typeof useTextBuffer> | null } = {
        current: null,
      };

      const { result } = renderHook(() => {
        const buffer = useTextBufferForTest('cp ./file1');
        bufferRef.current = buffer;
        return useShellPathCompletion(buffer, testRootDir, true, false);
      });

      await waitFor(() => {
        expect(result.current.suggestions.length).toBeGreaterThan(0);
      });

      const fileIdx = result.current.suggestions.findIndex(
        (s) => s.value === './file1.txt',
      );
      expect(fileIdx).toBeGreaterThanOrEqual(0);

      act(() => {
        result.current.handleAutocomplete(fileIdx);
      });

      expect(bufferRef.current?.text).toContain('cp ');
      expect(bufferRef.current?.text).toContain('./file1.txt');
    });

    it('should insert escaped paths for names with spaces', async () => {
      const spacesStructure: FileSystemStructure = {
        'my file.txt': '',
        'my dir': {
          'nested.txt': '',
        },
      };
      const spacesDir = await createTmpDir(spacesStructure);

      try {
        const bufferRef: {
          current: ReturnType<typeof useTextBuffer> | null;
        } = {
          current: null,
        };

        const { result } = renderHook(() => {
          const buffer = useTextBufferForTest('ls ./my');
          bufferRef.current = buffer;
          return useShellPathCompletion(buffer, spacesDir, true, false);
        });

        await waitFor(() => {
          expect(result.current.suggestions.length).toBeGreaterThan(0);
        });

        const dirIdx = result.current.suggestions.findIndex(
          (s) => s.value === './my\\ dir/',
        );
        expect(dirIdx).toBeGreaterThanOrEqual(0);

        act(() => {
          result.current.handleAutocomplete(dirIdx);
        });

        expect(bufferRef.current?.text).toBe('ls ./my\\ dir/');
      } finally {
        await cleanupTmpDir(spacesDir);
      }
    });
  });
});
