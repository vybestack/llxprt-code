/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { act } from 'react';
import { useSlashCompletion } from './useSlashCompletion.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { FileDiscoveryService } from '@vybestack/llxprt-code-storage';
import { useTextBuffer } from '../components/shared/text-buffer.js';

describe('useSlashCompletion', () => {
  let testRootDir: string;
  let mockConfig: Config;
  const mockCommandContext = {} as CommandContext;
  let testDirs: string[];

  async function createEmptyDir(...pathSegments: string[]): Promise<string> {
    const fullPath = path.join(testRootDir, ...pathSegments);
    await fs.mkdir(fullPath, { recursive: true });
    return fullPath;
  }

  async function createTestFile(
    content: string,
    ...pathSegments: string[]
  ): Promise<string> {
    const fullPath = path.join(testRootDir, ...pathSegments);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

  function useTextBufferForTest(text: string, cursorOffset?: number) {
    return useTextBuffer({
      initialText: text,
      initialCursorOffset: cursorOffset ?? text.length,
      viewport: { width: 80, height: 20 },
      isValidPath: () => false,
      onChange: () => {},
    });
  }

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slash-completion-unit-test-'),
    );
    testDirs = [testRootDir];
    mockConfig = {
      getTargetDir: () => testRootDir,
      getWorkspaceContext: () => ({
        getDirectories: () => testDirs,
      }),
      getProjectRoot: () => testRootDir,
      getFileFilteringOptions: vi.fn(() => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      })),
      getEnableRecursiveFileSearch: vi.fn(() => true),
      getFileService: vi.fn(() => new FileDiscoveryService(testRootDir)),
    } as unknown as Config;

    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRootDir, { recursive: true, force: true });
  });

  describe('handleAutocomplete', () => {
    it('should complete a partial command', () => {
      const slashCommands = [
        {
          name: 'memory',
          description: 'Manage memory',
          subCommands: [
            {
              name: 'show',
              description: 'Show memory',
            },
            {
              name: 'add',
              description: 'Add to memory',
            },
          ],
        },
      ] as unknown as SlashCommand[];

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/mem');
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          slashCommands,
          mockCommandContext,
          false,

          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'memory',
      ]);

      act(() => {
        result.current.handleAutocomplete(0);
      });

      expect(result.current.textBuffer.text).toBe('/memory ');
    });

    it('should return the resulting text from handleAutocomplete', () => {
      const slashCommands = [
        {
          name: 'help',
          description: 'Show help',
          autoExecute: true,
        },
      ] as unknown as SlashCommand[];

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/he');
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          slashCommands,
          mockCommandContext,
          false,

          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'help',
      ]);

      let returnedText: string | undefined;
      act(() => {
        returnedText = result.current.handleAutocomplete(0);
      });

      expect(returnedText).toBe('/help ');
      expect(result.current.textBuffer.text).toBe('/help ');
    });

    it('should return undefined for out-of-bounds index', () => {
      const slashCommands = [
        {
          name: 'help',
          description: 'Show help',
        },
      ] as unknown as SlashCommand[];

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/he');
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          slashCommands,
          mockCommandContext,
          false,

          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      let returnedText: string | undefined;
      act(() => {
        returnedText = result.current.handleAutocomplete(99);
      });

      expect(returnedText).toBeUndefined();
    });

    it('should append a sub-command when the parent is complete', () => {
      const slashCommands = [
        {
          name: 'memory',
          description: 'Manage memory',
          subCommands: [
            {
              name: 'show',
              description: 'Show memory',
            },
            {
              name: 'add',
              description: 'Add to memory',
            },
          ],
        },
      ] as unknown as SlashCommand[];

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/memory ');
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          slashCommands,
          mockCommandContext,
          false,

          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      // Suggestions are populated by useEffect
      expect(result.current.suggestions.map((s) => s.value)).toStrictEqual([
        'show',
        'add',
      ]);

      act(() => {
        result.current.handleAutocomplete(1); // index 1 is 'add'
      });

      expect(result.current.textBuffer.text).toBe('/memory add ');
    });

    it('should complete a command with an alternative name', () => {
      const slashCommands = [
        {
          name: 'memory',
          description: 'Manage memory',
          subCommands: [
            {
              name: 'show',
              description: 'Show memory',
            },
            {
              name: 'add',
              description: 'Add to memory',
            },
          ],
        },
      ] as unknown as SlashCommand[];

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/?');
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          slashCommands,
          mockCommandContext,
          false,

          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      result.current.suggestions.push({
        label: 'help',
        value: 'help',
        description: 'Show help',
      });

      act(() => {
        result.current.handleAutocomplete(0);
      });

      expect(result.current.textBuffer.text).toBe('/help ');
    });

    it('should complete a file path', () => {
      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('@src/fi');
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      result.current.suggestions.push({
        label: 'file1.txt',
        value: 'file1.txt',
      });

      act(() => {
        result.current.handleAutocomplete(0);
      });

      expect(result.current.textBuffer.text).toBe('@src/file1.txt ');
    });

    it('should complete a file path when cursor is not at the end of the line', () => {
      const text = '@src/fi le.txt';
      const cursorOffset = 7; // after "i"

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest(text, cursorOffset);
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      result.current.suggestions.push({
        label: 'file1.txt',
        value: 'file1.txt',
      });

      act(() => {
        result.current.handleAutocomplete(0);
      });

      expect(result.current.textBuffer.text).toBe('@src/file1.txt  le.txt');
    });

    it('should complete the correct file path with multiple @-commands', () => {
      const text = '@file1.txt @src/fi';

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest(text);
        const completion = useSlashCompletion(
          textBuffer,
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        );
        return { ...completion, textBuffer };
      });

      result.current.suggestions.push({
        label: 'file2.txt',
        value: 'file2.txt',
      });

      act(() => {
        result.current.handleAutocomplete(0);
      });

      expect(result.current.textBuffer.text).toBe('@file1.txt @src/file2.txt ');
    });
  });

  describe('File Path Escaping', () => {
    it('should escape special characters in file names', async () => {
      await createTestFile('', 'my file.txt');
      await createTestFile('', 'file(1).txt');
      await createTestFile('', 'backup[old].txt');

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@my'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      let suggestion: { label: string; value: string } | undefined;
      await waitFor(() => {
        suggestion = result.current.suggestions.find(
          (s) => s.label === 'my file.txt',
        );
        expect(suggestion).toBeDefined();
      });
      expect(suggestion!.value).toBe('my\\ file.txt');
    });

    it('should escape parentheses in file names', async () => {
      await createTestFile('', 'document(final).docx');
      await createTestFile('', 'script(v2).sh');

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@doc'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      let suggestion: { label: string; value: string } | undefined;
      await waitFor(() => {
        suggestion = result.current.suggestions.find(
          (s) => s.label === 'document(final).docx',
        );
        expect(suggestion).toBeDefined();
      });
      expect(suggestion!.value).toBe('document\\(final\\).docx');
    });

    it('should escape square brackets in file names', async () => {
      await createTestFile('', 'backup[2024-01-01].zip');
      await createTestFile('', 'config[dev].json');

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@backup'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      let suggestion: { label: string; value: string } | undefined;
      await waitFor(() => {
        suggestion = result.current.suggestions.find(
          (s) => s.label === 'backup[2024-01-01].zip',
        );
        expect(suggestion).toBeDefined();
      });
      expect(suggestion!.value).toBe('backup\\[2024-01-01\\].zip');
    });

    it('should escape multiple special characters in file names', async () => {
      await createTestFile('', 'my file (backup) [v1.2].txt');
      await createTestFile('', 'data & config {prod}.json');

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@my'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      // Use waitFor to robustly poll for the suggestion under load
      let suggestion: { label: string; value: string } | undefined;
      await waitFor(() => {
        suggestion = result.current.suggestions.find(
          (s) => s.label === 'my file (backup) [v1.2].txt',
        );
        expect(suggestion).toBeDefined();
      });

      expect(suggestion!.value).toBe(
        'my\\ file\\ \\(backup\\)\\ \\[v1.2\\].txt',
      );
    });

    it('should preserve path separators while escaping special characters', async () => {
      await createTestFile(
        '',
        'projects',
        'my project (2024)',
        'file with spaces.txt',
      );

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@projects/my'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      let suggestion: { label: string; value: string } | undefined;
      await waitFor(() => {
        suggestion = result.current.suggestions.find((s) =>
          s.label.includes('my project'),
        );
        expect(suggestion).toBeDefined();
      });
      // Should escape spaces and parentheses but preserve forward slashes
      expect(suggestion!.value).toMatch(/my\\ project\\ \\\(2024\\\)/);
      expect(suggestion!.value).toContain('/'); // Should contain forward slash for path separator
    });

    it('should normalize Windows path separators to forward slashes while preserving escaping', async () => {
      // Create test with complex nested structure
      await createTestFile(
        '',
        'deep',
        'nested',
        'special folder',
        'file with (parentheses).txt',
      );

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@deep/nested/special'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      let suggestion: { label: string; value: string } | undefined;
      await waitFor(() => {
        suggestion = result.current.suggestions.find((s) =>
          s.label.includes('special folder'),
        );
        expect(suggestion).toBeDefined();
      });
      // Should use forward slashes for path separators and escape spaces
      expect(suggestion!.value).toContain('special\\ folder/');
      expect(suggestion!.value).not.toContain('\\\\'); // Should not contain double backslashes for path separators
    });

    it('should handle directory names with special characters', async () => {
      await createEmptyDir('my documents (personal)');
      await createEmptyDir('config [production]');
      await createEmptyDir('data & logs');

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      await waitFor(() => {
        const suggestions = result.current.suggestions;

        const docSuggestion = suggestions.find(
          (s) => s.label === 'my documents (personal)/',
        );
        expect(docSuggestion).toBeDefined();
        expect(docSuggestion!.value).toBe('my\\ documents\\ \\(personal\\)/');

        const configSuggestion = suggestions.find(
          (s) => s.label === 'config [production]/',
        );
        expect(configSuggestion).toBeDefined();
        expect(configSuggestion!.value).toBe('config\\ \\[production\\]/');

        const dataSuggestion = suggestions.find(
          (s) => s.label === 'data & logs/',
        );
        expect(dataSuggestion).toBeDefined();
        expect(dataSuggestion!.value).toBe('data\\ \\&\\ logs/');
      });
    });

    it('should handle files with various shell metacharacters', async () => {
      await createTestFile('', 'file$var.txt');
      await createTestFile('', 'important!.md');

      const { result } = renderHook(() =>
        useSlashCompletion(
          useTextBufferForTest('@'),
          testDirs,
          testRootDir,
          [],
          mockCommandContext,
          false,
          mockConfig,
        ),
      );

      await waitFor(() => {
        const suggestions = result.current.suggestions;

        const dollarSuggestion = suggestions.find(
          (s) => s.label === 'file$var.txt',
        );
        expect(dollarSuggestion).toBeDefined();
        expect(dollarSuggestion!.value).toBe('file\\$var.txt');

        const importantSuggestion = suggestions.find(
          (s) => s.label === 'important!.md',
        );
        expect(importantSuggestion).toBeDefined();
        expect(importantSuggestion!.value).toBe('important\\!.md');
      });
    });
  });
});
