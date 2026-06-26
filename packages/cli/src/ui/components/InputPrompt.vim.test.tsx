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

  describe('queued message editing', () => {
    it('should load all queued messages when up arrow is pressed with empty input', async () => {
      const mockPopAllMessages = vi.fn();
      mockPopAllMessages.mockReturnValue('Message 1\n\nMessage 2\n\nMessage 3');
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = '';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() => expect(mockPopAllMessages).toHaveBeenCalled());

      expect(props.buffer.setText).toHaveBeenCalledWith(
        'Message 1\n\nMessage 2\n\nMessage 3',
      );
      unmount();
    });

    it('should not load queued messages when input is not empty', async () => {
      const mockPopAllMessages = vi.fn();
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = 'some text';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() =>
        expect(mockInputHistory.navigateUp).toHaveBeenCalled(),
      );
      expect(mockPopAllMessages).not.toHaveBeenCalled();
      unmount();
    });

    it('should handle undefined messages from popAllMessages', async () => {
      const mockPopAllMessages = vi.fn();
      mockPopAllMessages.mockReturnValue(undefined);
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = '';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() => expect(mockPopAllMessages).toHaveBeenCalled());

      expect(props.buffer.setText).not.toHaveBeenCalled();
      expect(mockInputHistory.navigateUp).toHaveBeenCalled();
      unmount();
    });

    it('should work with NAVIGATION_UP key as well', async () => {
      const mockPopAllMessages = vi.fn();
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = '';
      props.buffer.allVisualLines = [''];
      props.buffer.visualCursor = [0, 0];
      props.buffer.visualScrollRow = 0;

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() => expect(mockPopAllMessages).toHaveBeenCalled());
      unmount();
    });

    it('should handle single queued message', async () => {
      const mockPopAllMessages = vi.fn();
      mockPopAllMessages.mockReturnValue('Single message');
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = '';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() => expect(mockPopAllMessages).toHaveBeenCalled());

      expect(props.buffer.setText).toHaveBeenCalledWith('Single message');
      unmount();
    });

    it('should only check for queued messages when buffer text is trimmed empty', async () => {
      const mockPopAllMessages = vi.fn();
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = '   '; // Whitespace only

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() => expect(mockPopAllMessages).toHaveBeenCalled());
      unmount();
    });

    it('should not call popAllMessages if it is not provided', async () => {
      props.popAllMessages = undefined;
      props.buffer.text = '';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() =>
        expect(mockInputHistory.navigateUp).toHaveBeenCalled(),
      );
      unmount();
    });

    it('should navigate input history on fresh start when no queued messages exist', async () => {
      const mockPopAllMessages = vi.fn();
      mockPopAllMessages.mockReturnValue(undefined);
      props.popAllMessages = mockPopAllMessages;
      props.buffer.text = '';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\u001B[A');
      });
      await waitFor(() => expect(mockPopAllMessages).toHaveBeenCalled());

      expect(mockInputHistory.navigateUp).toHaveBeenCalled();
      expect(props.buffer.setText).not.toHaveBeenCalled();

      unmount();
    });
  });

  describe('snapshots', () => {
    it('should render correctly in shell mode', async () => {
      props.shellModeActive = true;
      const { stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await waitFor(() => expect(stdout.lastFrame()).toMatchSnapshot());
      unmount();
    });

    it('should render correctly when accepting edits', async () => {
      props.approvalMode = ApprovalMode.AUTO_EDIT;
      const { stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await waitFor(() => expect(stdout.lastFrame()).toMatchSnapshot());
      unmount();
    });

    it('should render correctly in yolo mode', async () => {
      props.approvalMode = ApprovalMode.YOLO;
      const { stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await waitFor(() => expect(stdout.lastFrame()).toMatchSnapshot());
      unmount();
    });

    it('should not show inverted cursor when shell is focused', async () => {
      props.isEmbeddedShellFocused = true;
      props.focus = false;
      const { stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await waitFor(() => {
        expect(stdout.lastFrame()).not.toContain(`{chalk.inverse(' ')}`);
        expect(stdout.lastFrame()).toMatchSnapshot();
      });
      unmount();
    });
  });

  it('should still allow input when shell is not focused', async () => {
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('a');
    });
    await waitFor(() => expect(mockBuffer.handleInput).toHaveBeenCalled());
    unmount();
  });

  it('should not process typed keys when embedded shell is focused', async () => {
    props.isEmbeddedShellFocused = true;
    props.focus = true;
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('a');
    });

    expect(mockBuffer.handleInput).not.toHaveBeenCalled();
    unmount();
  });

  describe('command queuing while streaming', () => {
    beforeEach(() => {
      props.streamingState = StreamingState.Responding;
      props.setQueueErrorMessage = vi.fn();
      props.onSubmit = vi.fn();
    });

    it.each([
      {
        name: 'should prevent slash commands',
        bufferText: '/help',
        shellMode: false,
        errorMessage: 'Slash commands cannot be queued',
      },
      {
        name: 'should prevent shell commands',
        bufferText: 'ls',
        shellMode: true,
        errorMessage: 'Shell commands cannot be queued',
      },
    ])('$name', async ({ bufferText, shellMode, errorMessage }) => {
      props.buffer.text = bufferText;
      props.shellModeActive = shellMode;

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await act(async () => {
        stdin.write('\r');
      });
      await waitFor(() => {
        expect(props.onSubmit).not.toHaveBeenCalled();
        expect(props.setQueueErrorMessage).toHaveBeenCalledWith(errorMessage);
      });
      unmount();
    });

    it('should allow regular messages', async () => {
      const bufferText = 'regular message';
      props.buffer.text = bufferText;
      props.shellModeActive = false;

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await act(async () => {
        stdin.write('\r');
      });
      await waitFor(() => {
        expect(props.onSubmit).toHaveBeenCalledWith(bufferText);
        expect(props.setQueueErrorMessage).not.toHaveBeenCalled();
      });
      unmount();
    });
  });

  describe('shell path completion', () => {
    // User-visible behavior tests
    it.todo(
      'should show path suggestions when typing a tilde path in shell mode',
    );
    it.todo('should accept path suggestion on Tab in shell mode');
    it.todo(
      'should navigate path suggestions with Up/Down when suggestions are visible',
    );
    it.todo(
      'should navigate shell history with Up/Down when NO suggestions are visible',
    );
    it.todo('should clear path suggestions when exiting shell mode via Escape');
    it.todo('should not show path suggestions when reverse search is active');
    it.todo('should not interfere with @ completion in normal mode');
    it.todo(
      'should not show path suggestions for non-path tokens in shell mode',
    );

    // Key precedence matrix tests
    it.todo(
      'Tab in shell mode with path suggestions: accepts suggestion (not submit)',
    );
    it.todo(
      'Enter in shell mode with path suggestions: submits command (not accept suggestion)',
    );
    it.todo(
      'Up/Down in shell mode with path suggestions: navigates suggestions (not history)',
    );
    it.todo(
      'Up/Down in shell mode without suggestions: navigates shell history',
    );
    it.todo('Escape in shell mode with path suggestions: exits shell mode');
  });
});
