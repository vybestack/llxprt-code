/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';

const { schemaHandlerSpy, createHandlerMock } = vi.hoisted(() => {
  const schemaHandlerSpy = vi.fn().mockResolvedValue({
    suggestions: [
      { value: 'alpha', description: 'alpha option' },
      { value: 'beta', description: 'beta option' },
    ],
    hint: 'Select option',
    position: 1,
  });
  const createHandlerMock = vi.fn(() => schemaHandlerSpy);
  return { schemaHandlerSpy, createHandlerMock };
});

vi.mock('../schema/index.js', () => ({
  createCompletionHandler: createHandlerMock,
}));

import { renderHook, waitFor } from '../../../test-utils/render.js';
import { useSlashCompletion } from '../../hooks/useSlashCompletion.js';
import { useTextBuffer } from '../../components/shared/text-buffer.js';
import { CommandContext, CommandKind, SlashCommand } from '../types.js';
import { Config, FileDiscoveryService } from '@vybestack/llxprt-code-core';

const mockCommandContext = {} as CommandContext;

const mockConfig = {
  getTargetDir: () => '/',
  getWorkspaceContext: () => ({
    getDirectories: () => [],
  }),
  getProjectRoot: () => '/',
  getFileFilteringOptions: () => ({
    respectGitIgnore: true,
    respectLlxprtIgnore: true,
  }),
  getEnableRecursiveFileSearch: () => false,
  getFileService: () => new FileDiscoveryService('/'),
} as unknown as Config;

function useTextBufferForTest(text: string, cursorOffset?: number) {
  return useTextBuffer({
    initialText: text,
    initialCursorOffset: cursorOffset ?? text.length,
    viewport: { width: 80, height: 20 },
    isValidPath: () => false,
    onChange: () => {},
  });
}

describe('useSlashCompletion schema gating', () => {
  const schemaDrivenSetCommand: SlashCommand = {
    name: 'set',
    description: 'set command',
    kind: CommandKind.BUILT_IN,
    schema: [
      {
        kind: 'literal',
        value: 'alpha',
        description: 'alpha option',
        next: [
          {
            kind: 'value',
            name: 'alpha-value',
            description: 'alpha value',
          },
        ],
      },
      {
        kind: 'literal',
        value: 'beta',
        description: 'beta option',
        next: [
          {
            kind: 'value',
            name: 'beta-value',
            description: 'beta value',
          },
        ],
      },
    ],
  };

  it('requires a space or partial argument before schema completions run', async () => {
    const slashCommands = [schemaDrivenSetCommand];
    const { result } = renderHook(
      ({ text }) => {
        const textBuffer = useTextBufferForTest(text);
        return useSlashCompletion(
          textBuffer,
          [],
          '/',
          slashCommands,
          mockCommandContext,
          false,
          mockConfig,
        );
      },
      { initialProps: { text: '/set' } },
    );

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([]);
      expect(result.current.showSuggestions).toBe(false);
      expect(createHandlerMock).not.toHaveBeenCalled();
    });

    expect(createHandlerMock).not.toHaveBeenCalled();
    expect(schemaHandlerSpy).not.toHaveBeenCalled();
  });
});
