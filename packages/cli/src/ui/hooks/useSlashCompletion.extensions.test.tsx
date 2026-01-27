/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 3 TDD Tests - Tab Completion Extension Filtering
 *
 * These tests verify that tab completion shows/hides extension commands
 * based on runtime enable/disable state.
 *
 * EXPECTED: All tests should FAIL initially because tab completion
 * doesn't yet filter based on extension enabled state.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useSlashCompletion } from './useSlashCompletion.js';
import {
  CommandContext,
  SlashCommand,
  CommandKind,
} from '../commands/types.js';
import { Config } from '@vybestack/llxprt-code-core';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

describe('Tab Completion Extension Filtering (Phase 3 TDD)', () => {
  let mockCommandContext: CommandContext;
  let mockConfig: Config;
  const testDirs: string[] = ['/test/project'];
  const testRootDir = '/test/project';

  // Helper to create TextBuffer within renderHook
  function useTextBufferForTest(text: string, cursorOffset?: number) {
    return useTextBuffer({
      initialText: text,
      initialCursorOffset: cursorOffset ?? text.length,
      viewport: { width: 80, height: 20 },
      isValidPath: () => false,
      onChange: () => {},
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCommandContext = createMockCommandContext();
    mockConfig = {
      getEnablePromptCompletion: () => false,
    } as unknown as Config;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Extension Command Visibility', () => {
    it('should include extension commands in completion when extension is enabled', async () => {
      // Setup: Create extension command and enabled extension
      const extensionCommands: SlashCommand[] = [
        {
          name: 'mycommand',
          kind: CommandKind.EXTENSION,
          description: 'My extension command',
          action: vi.fn(),
          extensionName: 'my-ext',
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
      ];

      const allCommands = [...builtinCommands, ...extensionCommands];

      // Mock the extension as enabled
      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: (name: string) => name === 'my-ext',
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/my');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: '/mycommand' should appear in suggestions
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        const myCommandSuggestion = suggestions.find(
          (s) => s.value === 'mycommand',
        );
        expect(myCommandSuggestion).toBeDefined();
        expect(myCommandSuggestion?.label).toBe('mycommand');
      });
    });

    it('should exclude extension commands from completion when extension is disabled', async () => {
      // Setup: Create extension command but disable extension
      const extensionCommands: SlashCommand[] = [
        {
          name: 'mycommand',
          kind: CommandKind.EXTENSION,
          description: 'My extension command',
          action: vi.fn(),
          extensionName: 'my-ext',
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
      ];

      const allCommands = [...builtinCommands, ...extensionCommands];

      // Mock the extension as disabled
      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: (_name: string) => false,
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/my');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: '/mycommand' should NOT appear in suggestions
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        const myCommandSuggestion = suggestions.find(
          (s) => s.value === 'mycommand',
        );
        expect(myCommandSuggestion).toBeUndefined();
      });
    });

    it('should update completions after extension state change (via command list update)', async () => {
      // In the real application flow:
      // 1. User disables extension -> sessionState.set(name, false)
      // 2. UI calls reloadCommands() -> CommandService rebuilds with new BuiltinCommandLoader
      // 3. BuiltinCommandLoader.loadCommands() filters out disabled extensions
      // 4. useSlashCompletion gets the NEW (filtered) command list
      //
      // This test simulates that flow by providing different command lists

      const extensionCommand: SlashCommand = {
        name: 'mycommand',
        kind: CommandKind.EXTENSION,
        description: 'My extension command',
        action: vi.fn(),
        extensionName: 'my-ext',
      };

      const builtinCommand: SlashCommand = {
        name: 'help',
        kind: CommandKind.BUILT_IN,
        description: 'Show help',
        action: vi.fn(),
      };

      // Phase 1: Extension enabled - command list includes extension command
      const commandsWithExtension = [builtinCommand, extensionCommand];

      // Phase 2: Extension disabled - command list excludes extension command
      // (This is what BuiltinCommandLoader.loadCommands() returns after filtering)
      const commandsWithoutExtension = [builtinCommand];

      const { result, rerender } = renderHook(
        ({ commands }) => {
          const textBuffer = useTextBufferForTest('/my');
          return {
            textBuffer,
            completion: useSlashCompletion(
              textBuffer,
              testDirs,
              testRootDir,
              commands,
              mockCommandContext,
              false,
              mockConfig,
            ),
          };
        },
        { initialProps: { commands: commandsWithExtension } },
      );

      // STEP 1: Command should show when in the command list
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions.find((s) => s.value === 'mycommand')).toBeDefined();
      });

      // STEP 2: Simulate reloadCommands() by providing filtered command list
      // Pass a NEW array reference (this is what happens with rerender)
      rerender({ commands: commandsWithoutExtension });

      // STEP 3: Command should no longer appear (it's not in the list)
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(
          suggestions.find((s) => s.value === 'mycommand'),
        ).toBeUndefined();
      });
    });

    it('should always include built-in commands in completions', async () => {
      // Setup: Disable all extensions
      const extensionCommands: SlashCommand[] = [
        {
          name: 'extcmd',
          kind: CommandKind.EXTENSION,
          description: 'Extension command',
          action: vi.fn(),
          extensionName: 'some-ext',
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
        {
          name: 'extensions',
          kind: CommandKind.BUILT_IN,
          description: 'Manage extensions',
          action: vi.fn(),
        },
      ];

      const allCommands = [...builtinCommands, ...extensionCommands];

      // All extensions disabled
      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: () => false,
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: Built-in commands should still appear
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions.find((s) => s.value === 'help')).toBeDefined();
        expect(suggestions.find((s) => s.value === 'extensions')).toBeDefined();
        expect(suggestions.find((s) => s.value === 'extcmd')).toBeUndefined();
      });
    });

    it('should filter partial matches correctly for extension commands (via command list update)', async () => {
      // Same pattern as above - filter happens in BuiltinCommandLoader, not in useSlashCompletion
      const extensionCommands: SlashCommand[] = [
        {
          name: 'mycommand',
          kind: CommandKind.EXTENSION,
          description: 'My command',
          action: vi.fn(),
          extensionName: 'my-ext',
        },
        {
          name: 'myother',
          kind: CommandKind.EXTENSION,
          description: 'My other command',
          action: vi.fn(),
          extensionName: 'my-ext',
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
      ];

      // Phase 1: All commands present
      const commandsEnabled = [...builtinCommands, ...extensionCommands];
      // Phase 2: Extension commands filtered out by BuiltinCommandLoader
      const commandsDisabled = [...builtinCommands];

      const { result, rerender } = renderHook(
        ({ commands }) => {
          const textBuffer = useTextBufferForTest('/my');
          return {
            textBuffer,
            completion: useSlashCompletion(
              textBuffer,
              testDirs,
              testRootDir,
              commands,
              mockCommandContext,
              false,
              mockConfig,
            ),
          };
        },
        { initialProps: { commands: commandsEnabled } },
      );

      // STEP 1: Both commands should appear when in list
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions.find((s) => s.value === 'mycommand')).toBeDefined();
        expect(suggestions.find((s) => s.value === 'myother')).toBeDefined();
      });

      // STEP 2: Simulate reloadCommands() with filtered list (new array reference)
      rerender({ commands: commandsDisabled });

      // STEP 3: Both commands should disappear
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(
          suggestions.find((s) => s.value === 'mycommand'),
        ).toBeUndefined();
        expect(suggestions.find((s) => s.value === 'myother')).toBeUndefined();
      });
    });
  });

  describe('Extension Subcommand Filtering', () => {
    it('should filter extension subcommands based on parent extension state', async () => {
      // Setup: Extension with subcommands
      const extensionCommands: SlashCommand[] = [
        {
          name: 'myext',
          kind: CommandKind.EXTENSION,
          description: 'My extension',
          extensionName: 'my-ext',
          subCommands: [
            {
              name: 'sub1',
              kind: CommandKind.EXTENSION,
              description: 'Subcommand 1',
              action: vi.fn(),
              extensionName: 'my-ext',
            },
            {
              name: 'sub2',
              kind: CommandKind.EXTENSION,
              description: 'Subcommand 2',
              action: vi.fn(),
              extensionName: 'my-ext',
            },
          ],
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
      ];

      const allCommands = [...builtinCommands, ...extensionCommands];

      // Extension disabled
      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: () => false,
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/myext ');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: Subcommands should not appear when parent extension is disabled
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions.find((s) => s.value === 'sub1')).toBeUndefined();
        expect(suggestions.find((s) => s.value === 'sub2')).toBeUndefined();
      });
    });
  });

  describe('Mixed Extension and Built-in Commands', () => {
    it('should show both built-in and enabled extension commands together', async () => {
      const extensionCommands: SlashCommand[] = [
        {
          name: 'ext1',
          kind: CommandKind.EXTENSION,
          description: 'Extension 1',
          action: vi.fn(),
          extensionName: 'ext-1',
        },
        {
          name: 'ext2',
          kind: CommandKind.EXTENSION,
          description: 'Extension 2',
          action: vi.fn(),
          extensionName: 'ext-2',
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
        {
          name: 'extensions',
          kind: CommandKind.BUILT_IN,
          description: 'Manage extensions',
          action: vi.fn(),
        },
      ];

      const allCommands = [...builtinCommands, ...extensionCommands];

      // Enable only ext-1
      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: (name: string) => name === 'ext-1',
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/e');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: Built-in 'extensions' + enabled 'ext1', but not disabled 'ext2'
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions.find((s) => s.value === 'extensions')).toBeDefined();
        expect(suggestions.find((s) => s.value === 'ext1')).toBeDefined();
        expect(suggestions.find((s) => s.value === 'ext2')).toBeUndefined();
      });
    });
  });

  describe('Completion Behavior Edge Cases', () => {
    it('should not show disabled extension commands even with exact match', async () => {
      const extensionCommands: SlashCommand[] = [
        {
          name: 'exactmatch',
          kind: CommandKind.EXTENSION,
          description: 'Exact match command',
          action: vi.fn(),
          extensionName: 'my-ext',
        },
      ];

      const allCommands = [...extensionCommands];

      // Extension disabled
      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: () => false,
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/exactmatch');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: No suggestions, even though text exactly matches command name
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions).toHaveLength(0);
      });
    });

    it('should handle extension commands with no extensionName property gracefully', async () => {
      // Edge case: Extension command without extensionName should be treated as disabled
      const extensionCommands: SlashCommand[] = [
        {
          name: 'broken',
          kind: CommandKind.EXTENSION,
          description: 'Broken extension command',
          action: vi.fn(),
          // Note: no extensionName property
        },
      ];

      const builtinCommands: SlashCommand[] = [
        {
          name: 'help',
          kind: CommandKind.BUILT_IN,
          description: 'Show help',
          action: vi.fn(),
        },
      ];

      const allCommands = [...builtinCommands, ...extensionCommands];

      mockCommandContext.services.config = {
        ...mockCommandContext.services.config,
        isExtensionEnabled: () => true,
      } as unknown as Config;

      const { result } = renderHook(() => {
        const textBuffer = useTextBufferForTest('/');
        return {
          textBuffer,
          completion: useSlashCompletion(
            textBuffer,
            testDirs,
            testRootDir,
            allCommands,
            mockCommandContext,
            false,
            mockConfig,
          ),
        };
      });

      // EXPECT: Only built-in command appears, broken extension command filtered out
      await waitFor(() => {
        const suggestions = result.current.completion.suggestions;
        expect(suggestions.find((s) => s.value === 'help')).toBeDefined();
        expect(suggestions.find((s) => s.value === 'broken')).toBeUndefined();
      });
    });
  });
});
