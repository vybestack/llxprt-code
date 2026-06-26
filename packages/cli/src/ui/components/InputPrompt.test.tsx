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
import * as clipboardUtils from '../utils/clipboardUtils.js';
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

  it('should call shellHistory.getPreviousCommand on up arrow in shell mode', async () => {
    props.shellModeActive = true;
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\u001B[A');
    });
    await waitFor(() =>
      expect(mockShellHistory.getPreviousCommand).toHaveBeenCalled(),
    );
    unmount();
  });

  it('should call shellHistory.getNextCommand on down arrow in shell mode', async () => {
    props.shellModeActive = true;
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\u001B[B');
      await waitFor(() =>
        expect(mockShellHistory.getNextCommand).toHaveBeenCalled(),
      );
    });
    unmount();
  });

  it('should set the buffer text when a shell history command is retrieved', async () => {
    props.shellModeActive = true;
    vi.mocked(mockShellHistory.getPreviousCommand).mockReturnValue(
      'previous command',
    );
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\u001B[A');
    });
    await waitFor(() => {
      expect(mockShellHistory.getPreviousCommand).toHaveBeenCalled();
      expect(props.buffer.setText).toHaveBeenCalledWith('previous command');
    });
    unmount();
  });

  it('should call shellHistory.addCommandToHistory on submit in shell mode', async () => {
    props.shellModeActive = true;
    props.buffer.setText('ls -l');
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(mockShellHistory.addCommandToHistory).toHaveBeenCalledWith(
        'ls -l',
      );
      expect(props.onSubmit).toHaveBeenCalledWith('ls -l');
    });
    unmount();
  });

  it('should NOT call shell history methods when not in shell mode', async () => {
    props.buffer.setText('some text');
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\u001B[A'); // Up arrow
    });
    await waitFor(() => expect(mockInputHistory.navigateUp).toHaveBeenCalled());

    await act(async () => {
      stdin.write('\u001B[B'); // Down arrow
    });
    await waitFor(() =>
      expect(mockInputHistory.navigateDown).toHaveBeenCalled(),
    );

    await act(async () => {
      stdin.write('\r'); // Enter
    });
    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith('some text'),
    );

    expect(mockShellHistory.getPreviousCommand).not.toHaveBeenCalled();
    expect(mockShellHistory.getNextCommand).not.toHaveBeenCalled();
    expect(mockShellHistory.addCommandToHistory).not.toHaveBeenCalled();
    unmount();
  });

  it('should call completion.navigateUp for both up arrow and Ctrl+P when suggestions are showing', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [
        { label: 'memory', value: 'memory' },
        { label: 'memcache', value: 'memcache' },
      ],
    });

    props.buffer.setText('/mem');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    // Test up arrow
    await act(async () => {
      stdin.write('\u001B[A'); // Up arrow
    });
    await waitFor(() =>
      expect(mockCommandCompletion.navigateUp).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      stdin.write('\u0010'); // Ctrl+P
    });
    await waitFor(() =>
      expect(mockCommandCompletion.navigateUp).toHaveBeenCalledTimes(2),
    );
    expect(mockCommandCompletion.navigateDown).not.toHaveBeenCalled();

    unmount();
  });

  it('should call completion.navigateDown for both down arrow and Ctrl+N when suggestions are showing', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [
        { label: 'memory', value: 'memory' },
        { label: 'memcache', value: 'memcache' },
      ],
    });
    props.buffer.setText('/mem');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    // Test down arrow
    await act(async () => {
      stdin.write('\u001B[B'); // Down arrow
    });
    await waitFor(() =>
      expect(mockCommandCompletion.navigateDown).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      stdin.write('\u000E'); // Ctrl+N
    });
    await waitFor(() =>
      expect(mockCommandCompletion.navigateDown).toHaveBeenCalledTimes(2),
    );
    expect(mockCommandCompletion.navigateUp).not.toHaveBeenCalled();

    unmount();
  });

  it('should NOT call completion navigation when suggestions are not showing', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: false,
    });
    props.buffer.setText('some text');
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\u001B[A'); // Up arrow
    });
    await waitFor(() => expect(mockInputHistory.navigateUp).toHaveBeenCalled());
    await act(async () => {
      stdin.write('\u001B[B'); // Down arrow
    });
    await waitFor(() =>
      expect(mockInputHistory.navigateDown).toHaveBeenCalled(),
    );
    await act(async () => {
      stdin.write('\u0010'); // Ctrl+P
    });
    await act(async () => {
      stdin.write('\u000E'); // Ctrl+N
    });

    await waitFor(() => {
      expect(mockCommandCompletion.navigateUp).not.toHaveBeenCalled();
      expect(mockCommandCompletion.navigateDown).not.toHaveBeenCalled();
    });
    unmount();
  });

  describe('clipboard image paste', () => {
    beforeEach(() => {
      vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(false);
      vi.mocked(clipboardUtils.saveClipboardImage).mockResolvedValue(null);
      vi.mocked(clipboardUtils.cleanupOldClipboardImages).mockResolvedValue(
        undefined,
      );
    });

    it('should handle Ctrl+V when clipboard has an image', async () => {
      vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(true);
      vi.mocked(clipboardUtils.saveClipboardImage).mockResolvedValue(
        '/test/.gemini-clipboard/clipboard-123.png',
      );

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      // Send Ctrl+V
      await act(async () => {
        stdin.write('\x16'); // Ctrl+V
      });
      await waitFor(() => {
        expect(clipboardUtils.clipboardHasImage).toHaveBeenCalled();
        expect(clipboardUtils.saveClipboardImage).toHaveBeenCalledWith(
          props.config.getTargetDir(),
        );
        expect(clipboardUtils.cleanupOldClipboardImages).toHaveBeenCalledWith(
          props.config.getTargetDir(),
        );
        expect(mockBuffer.replaceRangeByOffset).toHaveBeenCalled();
      });
      unmount();
    });

    it('should not insert anything when clipboard has no image', async () => {
      vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(false);

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x16'); // Ctrl+V
      });
      await waitFor(() => {
        expect(clipboardUtils.clipboardHasImage).toHaveBeenCalled();
      });
      expect(clipboardUtils.saveClipboardImage).not.toHaveBeenCalled();
      expect(mockBuffer.setText).not.toHaveBeenCalled();
      unmount();
    });

    it('should handle image save failure gracefully', async () => {
      vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(true);
      vi.mocked(clipboardUtils.saveClipboardImage).mockResolvedValue(null);

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x16'); // Ctrl+V
      });
      await waitFor(() => {
        expect(clipboardUtils.saveClipboardImage).toHaveBeenCalled();
      });
      expect(mockBuffer.setText).not.toHaveBeenCalled();
      unmount();
    });

    it('should insert image path at cursor position with proper spacing', async () => {
      const imagePath = path.join(
        'test',
        '.gemini-clipboard',
        'clipboard-456.png',
      );
      vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(true);
      vi.mocked(clipboardUtils.saveClipboardImage).mockResolvedValue(imagePath);

      // Set initial text and cursor position
      mockBuffer.text = 'Hello world';
      mockBuffer.cursor = [0, 5]; // Cursor after "Hello"
      mockBuffer.lines = ['Hello world'];
      mockBuffer.replaceRangeByOffset = vi.fn();

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x16'); // Ctrl+V
      });
      await waitFor(() => {
        // Should insert at cursor position with spaces
        expect(mockBuffer.replaceRangeByOffset).toHaveBeenCalled();
      });

      // Get the actual call to see what path was used
      const actualCall = vi.mocked(mockBuffer.replaceRangeByOffset).mock
        .calls[0];
      expect(actualCall[0]).toBe(5); // start offset
      expect(actualCall[1]).toBe(5); // end offset
      expect(actualCall[2]).toBe(
        ' @' + path.relative(path.join('test', 'project', 'src'), imagePath),
      );
      unmount();
    });

    it('should handle errors during clipboard operations', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      vi.mocked(clipboardUtils.clipboardHasImage).mockRejectedValue(
        new Error('Clipboard error'),
      );

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x16'); // Ctrl+V
      });
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error handling clipboard image:',
          expect.any(Error),
        );
      });
      expect(mockBuffer.setText).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      unmount();
    });
  });

  it.each([
    {
      name: 'should complete a partial parent command',
      bufferText: '/mem',
      suggestions: [{ label: 'memory', value: 'memory', description: '...' }],
      activeIndex: 0,
    },
    {
      name: 'should append a sub-command when parent command is complete',
      bufferText: '/memory ',
      suggestions: [
        { label: 'show', value: 'show' },
        { label: 'add', value: 'add' },
      ],
      activeIndex: 1,
    },
    {
      name: 'should handle the backspace edge case correctly',
      bufferText: '/memory',
      suggestions: [
        { label: 'show', value: 'show' },
        { label: 'add', value: 'add' },
      ],
      activeIndex: 0,
    },
    {
      name: 'should complete a partial argument for a command',
      bufferText: '/chat resume fi-',
      suggestions: [{ label: 'fix-foo', value: 'fix-foo' }],
      activeIndex: 0,
    },
  ])('$name', async ({ bufferText, suggestions, activeIndex }) => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions,
      activeSuggestionIndex: activeIndex,
    });
    props.buffer.setText(bufferText);
    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => stdin.write('\t'));
    await waitFor(() =>
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(
        activeIndex,
      ),
    );
    unmount();
  });

  it('should autocomplete on Enter when suggestions are active, without submitting', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [{ label: 'memory', value: 'memory' }],
      activeSuggestionIndex: 0,
    });
    props.buffer.setText('/mem');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      // The app should autocomplete the text, NOT submit.
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0);
    });

    expect(props.onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('should complete a command based on its altNames', async () => {
    props.slashCommands = [
      {
        name: 'help',
        altNames: ['?'],
        kind: CommandKind.BUILT_IN,
        description: '...',
      },
    ];

    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [{ label: 'help', value: 'help' }],
      activeSuggestionIndex: 0,
    });
    props.buffer.setText('/?');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\t'); // Press Tab for autocomplete
    });
    await waitFor(() =>
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(0),
    );
    unmount();
  });

  it('should not submit on Enter when the buffer is empty or only contains whitespace', async () => {
    props.buffer.setText('   '); // Set buffer to whitespace

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r'); // Press Enter
    });

    await waitFor(() => {
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should submit directly on Enter when isPerfectMatch is true', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: false,
      isPerfectMatch: true,
    });
    props.buffer.setText('/clear');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('/clear'));
    unmount();
  });

  it('should execute perfect match on Enter even if suggestions are showing, if at first suggestion', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [
        { label: 'review', value: 'review' }, // Match is now at index 0
        { label: 'review-frontend', value: 'review-frontend' },
      ],
      activeSuggestionIndex: 0,
      isPerfectMatch: true,
    });
    props.buffer.text = '/review';

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />, {
      uiActions,
    });

    await act(async () => {
      stdin.write('\r');
    });

    await waitFor(() => {
      expect(props.onSubmit).toHaveBeenCalledWith('/review');
    });
    unmount();
  });

  it('should autocomplete and NOT execute on Enter if a DIFFERENT suggestion is selected even if perfect match', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: true,
      suggestions: [
        { label: 'review', value: 'review' },
        { label: 'review-frontend', value: 'review-frontend' },
      ],
      activeSuggestionIndex: 1, // review-frontend selected (not the perfect match at 0)
      isPerfectMatch: true, // /review is a perfect match
    });
    props.buffer.text = '/review';

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />, {
      uiActions,
    });

    await act(async () => {
      stdin.write('\r');
    });

    await waitFor(() => {
      // Should handle autocomplete for index 1
      expect(mockCommandCompletion.handleAutocomplete).toHaveBeenCalledWith(1);
      // Should NOT submit
      expect(props.onSubmit).not.toHaveBeenCalled();
    });
    unmount();
  });

  it('should submit directly on Enter when a complete leaf command is typed', async () => {
    mockedUseCommandCompletion.mockReturnValue({
      ...mockCommandCompletion,
      showSuggestions: false,
      isPerfectMatch: false, // Added explicit isPerfectMatch false
    });
    props.buffer.setText('/clear');

    const { stdin, unmount } = renderWithProviders(<InputPrompt {...props} />);

    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('/clear'));
    unmount();
  });
});
