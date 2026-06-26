/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import type { InputPromptProps } from './InputPrompt.js';
import { InputPrompt } from './InputPrompt.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import * as path from 'node:path';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UseShellHistoryReturn } from '../hooks/useShellHistory.js';
import { useShellHistory } from '../hooks/useShellHistory.js';
import type { UseCommandCompletionReturn } from '../hooks/useCommandCompletion.js';
import { useCommandCompletion } from '../hooks/useCommandCompletion.js';
import type { UseInputHistoryReturn } from '../hooks/useInputHistory.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import type { UseReverseSearchCompletionReturn } from '../hooks/useReverseSearchCompletion.js';
import { useReverseSearchCompletion } from '../hooks/useReverseSearchCompletion.js';
import { useKittyKeyboardProtocol } from '../hooks/useKittyKeyboardProtocol.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { StreamingState } from '../types.js';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';

vi.mock('../hooks/useShellHistory.js');
vi.mock('../hooks/useCommandCompletion.js');
vi.mock('../hooks/useInputHistory.js');
vi.mock('../hooks/useReverseSearchCompletion.js');
vi.mock('../utils/clipboardUtils.js');
vi.mock('../hooks/useKittyKeyboardProtocol.js');

const mockSlashCommands: SlashCommand[] = [
  {
    name: 'clear',
    kind: CommandKind.BUILT_IN,
    description: 'Clear screen',
    action: vi.fn(),
  },
  {
    name: 'memory',
    kind: CommandKind.BUILT_IN,
    description: 'Manage memory',
    subCommands: [
      {
        name: 'show',
        kind: CommandKind.BUILT_IN,
        description: 'Show memory',
        action: vi.fn(),
      },
      {
        name: 'add',
        kind: CommandKind.BUILT_IN,
        description: 'Add to memory',
        action: vi.fn(),
      },
      {
        name: 'refresh',
        kind: CommandKind.BUILT_IN,
        description: 'Refresh memory',
        action: vi.fn(),
      },
    ],
  },
  {
    name: 'chat',
    description: 'Manage chats',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      {
        name: 'resume',
        description: 'Resume a chat',
        kind: CommandKind.BUILT_IN,
        action: vi.fn(),
        completion: async () => ['fix-foo', 'fix-bar'],
      },
    ],
  },
];

describe('InputPrompt', () => {
  let props: InputPromptProps;
  let mockShellHistory: UseShellHistoryReturn;
  let mockCommandCompletion: UseCommandCompletionReturn;
  let mockInputHistory: UseInputHistoryReturn;
  let mockReverseSearchCompletion: UseReverseSearchCompletionReturn;
  let mockBuffer: TextBuffer;
  let mockCommandContext: CommandContext;

  const mockedUseShellHistory = vi.mocked(useShellHistory);
  const mockedUseCommandCompletion = vi.mocked(useCommandCompletion);
  const mockedUseInputHistory = vi.mocked(useInputHistory);
  const mockedUseReverseSearchCompletion = vi.mocked(
    useReverseSearchCompletion,
  );
  const mockedUseKittyKeyboardProtocol = vi.mocked(useKittyKeyboardProtocol);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(
      terminalCapabilityManager,
      'isKittyProtocolEnabled',
    ).mockReturnValue(true);

    mockCommandContext = createMockCommandContext();

    mockBuffer = {
      text: '',
      cursor: [0, 0],
      lines: [''],
      setText: vi.fn((newText: string) => {
        mockBuffer.text = newText;
        mockBuffer.lines = [newText];
        mockBuffer.cursor = [0, newText.length];
        mockBuffer.viewportVisualLines = [newText];
        mockBuffer.allVisualLines = [newText];
        mockBuffer.visualToLogicalMap = [[0, 0]];
      }),
      replaceRangeByOffset: vi.fn(),
      viewportVisualLines: [''],
      allVisualLines: [''],
      visualCursor: [0, 0],
      visualScrollRow: 0,
      handleInput: vi.fn(),
      move: vi.fn(),
      moveToOffset: vi.fn((offset: number) => {
        mockBuffer.cursor = [0, offset];
      }),
      moveToVisualPosition: vi.fn(),
      killLineRight: vi.fn(),
      killLineLeft: vi.fn(),
      openInExternalEditor: vi.fn(),
      newline: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      backspace: vi.fn(),
      preferredCol: null,
      selectionAnchor: null,
      insert: vi.fn(),
      del: vi.fn(),
      replaceRange: vi.fn(),
      deleteWordLeft: vi.fn(),
      deleteWordRight: vi.fn(),
      visualToLogicalMap: [[0, 0]],
    } as unknown as TextBuffer;

    mockShellHistory = {
      history: [],
      addCommandToHistory: vi.fn(),
      getPreviousCommand: vi.fn().mockReturnValue(null),
      getNextCommand: vi.fn().mockReturnValue(null),
      resetHistoryPosition: vi.fn(),
    };
    mockedUseShellHistory.mockReturnValue(mockShellHistory);

    mockCommandCompletion = {
      suggestions: [],
      activeSuggestionIndex: -1,
      isLoadingSuggestions: false,
      showSuggestions: false,
      visibleStartIndex: 0,
      isPerfectMatch: false,
      navigateUp: vi.fn(),
      navigateDown: vi.fn(),
      resetCompletionState: vi.fn(),
      setActiveSuggestionIndex: vi.fn(),
      setShowSuggestions: vi.fn(),
      handleAutocomplete: vi.fn(),
      promptCompletion: {
        text: '',
        accept: vi.fn(),
        clear: vi.fn(),
        isLoading: false,
        isActive: false,
        markSelected: vi.fn(),
      },
      getCommandFromSuggestion: vi.fn().mockReturnValue(null),
      isArgumentCompletion: false,
      leafCommand: null,
    };
    mockedUseCommandCompletion.mockReturnValue(mockCommandCompletion);

    mockInputHistory = {
      navigateUp: vi.fn(),
      navigateDown: vi.fn(),
      handleSubmit: vi.fn(),
    };
    mockedUseInputHistory.mockReturnValue(mockInputHistory);

    mockReverseSearchCompletion = {
      suggestions: [],
      activeSuggestionIndex: -1,
      visibleStartIndex: 0,
      showSuggestions: false,
      isLoadingSuggestions: false,
      navigateUp: vi.fn(),
      navigateDown: vi.fn(),
      handleAutocomplete: vi.fn(),
      resetCompletionState: vi.fn(),
    };
    mockedUseReverseSearchCompletion.mockReturnValue(
      mockReverseSearchCompletion,
    );

    mockedUseKittyKeyboardProtocol.mockReturnValue({
      enabled: false,
      checking: false,
    });

    props = {
      buffer: mockBuffer,
      onSubmit: vi.fn(),
      userMessages: [],
      onClearScreen: vi.fn(),
      config: {
        getProjectRoot: () => path.join('test', 'project'),
        getTargetDir: () => path.join('test', 'project', 'src'),
        getVimMode: () => false,
        getWorkspaceContext: () => ({
          getDirectories: () => ['/test/project/src'],
        }),
      } as unknown as Config,
      slashCommands: mockSlashCommands,
      commandContext: mockCommandContext,
      shellModeActive: false,
      setShellModeActive: vi.fn(),
      approvalMode: ApprovalMode.DEFAULT,
      inputWidth: 80,
      suggestionsWidth: 80,
      focus: true,
      setQueueErrorMessage: vi.fn(),
      streamingState: StreamingState.Idle,
    };
  });

  it('should auto-execute commands with autoExecute: true on Enter', async () => {
    const aboutCommand: SlashCommand = {
      name: 'about',
      kind: CommandKind.BUILT_IN,
      description: 'About command',
      action: vi.fn(),
      autoExecute: true,
    };

    const suggestion = { label: 'about', value: 'about' };

    mockCommandCompletion.handleAutocomplete = vi
      .fn()
      .mockReturnValue('/about ');

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(aboutCommand),
      isArgumentCompletion: false,
      leafCommand: null,
    });

    // User typed partial command
    props.buffer.setText('/ab');
    props.buffer.lines = ['/ab'];
    props.buffer.cursor = [0, 3];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Enter
    });

    await waitFor(() => {
      expect(props.onSubmit).toHaveBeenCalledWith('/about');
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
    });
    unmount();
  });

  it('should autocomplete commands with autoExecute: false on Enter', async () => {
    const shareCommand: SlashCommand = {
      name: 'share',
      kind: CommandKind.BUILT_IN,
      description: 'Share conversation to file',
      action: vi.fn(),
      autoExecute: false,
    };

    const suggestion = { label: 'share', value: 'share' };

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(shareCommand),
      isArgumentCompletion: false,
      leafCommand: null,
    });

    props.buffer.setText('/sh');
    props.buffer.lines = ['/sh'];
    props.buffer.cursor = [0, 3];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Enter
    });

    await waitFor(() => {
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should autocomplete on Tab, even for executable commands', async () => {
    const executableCommand: SlashCommand = {
      name: 'about',
      kind: CommandKind.BUILT_IN,
      description: 'About info',
      action: vi.fn(),
      autoExecute: true,
    };

    const suggestion = { label: 'about', value: 'about' };

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(executableCommand),
      isArgumentCompletion: false,
      leafCommand: null,
    });

    props.buffer.setText('/ab');
    props.buffer.lines = ['/ab'];
    props.buffer.cursor = [0, 3];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\t'); // Tab
    });

    await waitFor(() => {
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should autocomplete custom commands from .toml files on Enter', async () => {
    const customCommand: SlashCommand = {
      name: 'find-capital',
      kind: CommandKind.FILE,
      description: 'Find capital of a country',
      action: vi.fn(),
    };

    const suggestion = { label: 'find-capital', value: 'find-capital' };

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(customCommand),
      isArgumentCompletion: false,
      leafCommand: null,
    });

    props.buffer.setText('/find');
    props.buffer.lines = ['/find'];
    props.buffer.cursor = [0, 5];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Enter
    });

    await waitFor(() => {
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should auto-execute argument completion when command has autoExecute: true', async () => {
    const authCommand: SlashCommand = {
      name: 'auth',
      kind: CommandKind.BUILT_IN,
      description: 'Authenticate with MCP server',
      action: vi.fn(),
      autoExecute: true,
      completion: vi.fn().mockResolvedValue(['server1', 'server2']),
    };

    const suggestion = { label: 'server1', value: 'server1' };

    mockCommandCompletion.handleAutocomplete = vi
      .fn()
      .mockReturnValue('/mcp auth server1 ');

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(authCommand),
      isArgumentCompletion: true,
      leafCommand: authCommand,
    });

    props.buffer.setText('/mcp auth ');
    props.buffer.lines = ['/mcp auth '];
    props.buffer.cursor = [0, 10];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Enter
    });

    await waitFor(() => {
      expect(props.onSubmit).toHaveBeenCalledWith('/mcp auth server1');
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
    });
    unmount();
  });

  it('should autocomplete argument completion when command has autoExecute: false', async () => {
    const enableCommand: SlashCommand = {
      name: 'enable',
      kind: CommandKind.BUILT_IN,
      description: 'Enable an extension',
      action: vi.fn(),
      autoExecute: false,
      completion: vi.fn().mockResolvedValue(['ext1 --scope user']),
    };

    const suggestion = {
      label: 'ext1 --scope user',
      value: 'ext1 --scope user',
    };

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(enableCommand),
      isArgumentCompletion: true,
      leafCommand: enableCommand,
    });

    props.buffer.setText('/extensions enable ');
    props.buffer.lines = ['/extensions enable '];
    props.buffer.cursor = [0, 19];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Enter
    });

    await waitFor(() => {
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should autocomplete command name even with autoExecute: true if command has completion function', async () => {
    const resumeCommand: SlashCommand = {
      name: 'resume',
      kind: CommandKind.BUILT_IN,
      description: 'Resume a conversation',
      action: vi.fn(),
      autoExecute: true,
      completion: vi.fn().mockResolvedValue(['chat1', 'chat2']),
    };

    const suggestion = { label: 'resume', value: 'resume' };

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [suggestion],
      activeSuggestionIndex: 0,
      getCommandFromSuggestion: vi.fn().mockReturnValue(resumeCommand),
      isArgumentCompletion: false,
      leafCommand: null,
    });

    props.buffer.setText('/chat resu');
    props.buffer.lines = ['/chat resu'];
    props.buffer.cursor = [0, 10];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Enter
    });

    await waitFor(() => {
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should autocomplete an @-path on Enter without submitting', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [{ label: 'index.ts', value: 'index.ts' }],
      activeSuggestionIndex: 0,
    });
    props.buffer.setText('@src/components/');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() =>
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0),
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('should add a newline on enter when the line ends with a backslash', async () => {
    // This test simulates multi-line input, not submission
    mockBuffer.text = 'first line\\';
    mockBuffer.cursor = [0, 11];
    mockBuffer.lines = ['first line\\'];

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(props.buffer.backspace).toHaveBeenCalled();
      expect(props.buffer.newline).toHaveBeenCalled();
    });

    expect(props.onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('should clear the buffer on Ctrl+C if it has text', async () => {
    await act(async () => {
      props.buffer.setText('some text to clear');
    });
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\x03'); // Ctrl+C character
    });
    await waitFor(() => {
      expect(props.buffer.setText).toHaveBeenCalledWith('');
      expect(mockCommandCompletion.resetCompletionState).toHaveBeenCalled();
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('should NOT clear the buffer on Ctrl+C if it is empty', async () => {
    props.buffer.text = '';
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\x03'); // Ctrl+C character
    });

    await waitFor(() => {
      expect(props.buffer.setText).not.toHaveBeenCalled();
    });
    unmount();
  });

  describe('cursor-based completion trigger', () => {
    it.each([
      {
        name: 'should trigger completion when cursor is after @ without spaces',
        text: '@src/components',
        cursor: [0, 15],
        showSuggestions: true,
      },
      {
        name: 'should trigger completion when cursor is after / without spaces',
        text: '/memory',
        cursor: [0, 7],
        showSuggestions: true,
      },
      {
        name: 'should NOT trigger completion when cursor is after space following @',
        text: '@src/file.ts hello',
        cursor: [0, 18],
        showSuggestions: false,
      },
      {
        name: 'should NOT trigger completion when cursor is after space following /',
        text: '/memory add',
        cursor: [0, 11],
        showSuggestions: false,
      },
      {
        name: 'should NOT trigger completion when cursor is not after @ or /',
        text: 'hello world',
        cursor: [0, 5],
        showSuggestions: false,
      },
      {
        name: 'should handle multiline text correctly',
        text: 'first line\n/memory',
        cursor: [1, 7],
        showSuggestions: false,
      },
      {
        name: 'should handle Unicode characters (emojis) correctly in paths',
        text: '@src/file👍.txt',
        cursor: [0, 14],
        showSuggestions: true,
      },
      {
        name: 'should handle Unicode characters with spaces after them',
        text: '@src/file👍.txt hello',
        cursor: [0, 20],
        showSuggestions: false,
      },
      {
        name: 'should handle escaped spaces in paths correctly',
        text: '@src/my\\ file.txt',
        cursor: [0, 16],
        showSuggestions: true,
      },
      {
        name: 'should NOT trigger completion after unescaped space following escaped space',
        text: '@path/my\\ file.txt hello',
        cursor: [0, 24],
        showSuggestions: false,
      },
      {
        name: 'should handle multiple escaped spaces in paths',
        text: '@docs/my\\ long\\ file\\ name.md',
        cursor: [0, 29],
        showSuggestions: true,
      },
      {
        name: 'should handle escaped spaces in slash commands',
        text: '/memory\\ test',
        cursor: [0, 13],
        showSuggestions: true,
      },
      {
        name: 'should handle Unicode characters with escaped spaces',
        text: `@${path.join('files', 'emoji\\ 👍\\ test.txt')}`,
        cursor: [0, 25],
        showSuggestions: true,
      },
    ])('$name', async ({ text, cursor, showSuggestions }) => {
      mockBuffer.text = text;
      mockBuffer.lines = text.split('\n');
      mockBuffer.cursor = cursor as [number, number];

      mockedUseCommandCompletion.mockReturnValue({
        ...mockCommandCompletion,
        showSuggestions,
        suggestions: showSuggestions
          ? [{ label: 'suggestion', value: 'suggestion' }]
          : [],
      });

      const { unmount } = renderWithProviders(<InputPrompt {...props} />);

      await waitFor(() => {
        expect(mockedUseCommandCompletion).toHaveBeenCalledWith(
          mockBuffer,
          path.join('test', 'project', 'src'),
          mockSlashCommands,
          mockCommandContext,
          false,
          false,
          expect.any(Object),
        );
      });

      unmount();
    });
  });

  describe('vim mode', () => {
    it('should not call buffer.handleInput when vim handles input', async () => {
      props.vimHandleInput = vi.fn().mockReturnValue(true);
      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => stdin.write('i'));
      await waitFor(() => {
        expect(props.vimHandleInput).toHaveBeenCalled();
        expect(mockBuffer.handleInput).not.toHaveBeenCalled();
      });
      unmount();
    });

    it.each([
      { name: 'should call buffer.handleInput when vim does not handle input' },
      { name: 'should call handleInput when vim mode is disabled' },
    ])('$name', async () => {
      props.vimHandleInput = vi.fn().mockReturnValue(false);
      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => stdin.write('i'));
      await waitFor(() => {
        expect(props.vimHandleInput).toHaveBeenCalled();
        expect(mockBuffer.handleInput).toHaveBeenCalled();
      });
      unmount();
    });
  });

  describe('unfocused paste', () => {
    it('should handle bracketed paste when not focused', async () => {
      props.focus = false;
      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x1B[200~pasted text\x1B[201~');
      });
      await waitFor(() => {
        expect(mockBuffer.handleInput).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'paste',
            sequence: 'pasted text',
          }),
        );
      });
      unmount();
    });

    it('should ignore regular keypresses when not focused', async () => {
      props.focus = false;
      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('a');
      });
      await waitFor(() => {});

      expect(mockBuffer.handleInput).not.toHaveBeenCalled();
      unmount();
    });
  });
});
