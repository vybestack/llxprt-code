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
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
import chalk from 'chalk';
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

  describe('Highlighting and Cursor Display', () => {
    describe('single-line scenarios', () => {
      it.each([
        {
          name: 'mid-word',
          text: 'hello world',
          visualCursor: [0, 3],
          expected: `hel${chalk.inverse('l')}o world`,
        },
        {
          name: 'at the beginning of the line',
          text: 'hello',
          visualCursor: [0, 0],
          expected: `${chalk.inverse('h')}ello`,
        },
        {
          name: 'at the end of the line',
          text: 'hello',
          visualCursor: [0, 5],
          expected: `hello${chalk.inverse(' ')}`,
        },
        {
          name: 'on a highlighted token',
          text: 'run @path/to/file',
          visualCursor: [0, 9],
          expected: `@path/${chalk.inverse('t')}o/file`,
        },
        {
          name: 'for multi-byte unicode characters',
          text: 'hello 👍 world',
          visualCursor: [0, 6],
          expected: `hello ${chalk.inverse('👍')} world`,
        },
        {
          name: 'at the end of a line with unicode characters',
          text: 'hello 👍',
          visualCursor: [0, 8],
          expected: `hello 👍${chalk.inverse(' ')}`,
        },
        {
          name: 'on an empty line',
          text: '',
          visualCursor: [0, 0],
          expected: chalk.inverse(' '),
        },
        {
          name: 'on a space between words',
          text: 'hello world',
          visualCursor: [0, 5],
          expected: `hello${chalk.inverse(' ')}world`,
        },
      ])(
        'should display cursor correctly $name',
        async ({ text, visualCursor, expected }) => {
          mockBuffer.text = text;
          mockBuffer.lines = [text];
          mockBuffer.viewportVisualLines = [text];
          mockBuffer.visualCursor = visualCursor as [number, number];

          const { stdout, unmount } = renderWithProviders(
            <InputPrompt {...props} />,
          );

          await waitFor(() => {
            const frame = stdout.lastFrame();
            expect(frame).toContain(expected);
          });
          unmount();
        },
      );
    });

    describe('multi-line scenarios', () => {
      it.each([
        {
          name: 'in the middle of a line',
          text: 'first line\nsecond line\nthird line',
          visualCursor: [1, 3],
          visualToLogicalMap: [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
          expected: `sec${chalk.inverse('o')}nd line`,
        },
        {
          name: 'at the beginning of a line',
          text: 'first line\nsecond line',
          visualCursor: [1, 0],
          visualToLogicalMap: [
            [0, 0],
            [1, 0],
          ],
          expected: `${chalk.inverse('s')}econd line`,
        },
        {
          name: 'at the end of a line',
          text: 'first line\nsecond line',
          visualCursor: [0, 10],
          visualToLogicalMap: [
            [0, 0],
            [1, 0],
          ],
          expected: `first line${chalk.inverse(' ')}`,
        },
      ])(
        'should display cursor correctly $name in a multiline block',
        async ({ text, visualCursor, expected, visualToLogicalMap }) => {
          mockBuffer.text = text;
          mockBuffer.lines = text.split('\n');
          mockBuffer.viewportVisualLines = text.split('\n');
          mockBuffer.visualCursor = visualCursor as [number, number];
          mockBuffer.visualToLogicalMap = visualToLogicalMap as Array<
            [number, number]
          >;

          const { stdout, unmount } = renderWithProviders(
            <InputPrompt {...props} />,
          );

          await waitFor(() => {
            const frame = stdout.lastFrame();
            expect(frame).toContain(expected);
          });
          unmount();
        },
      );

      it('should display cursor on a blank line in a multiline block', async () => {
        const text = 'first line\n\nthird line';
        mockBuffer.text = text;
        mockBuffer.lines = text.split('\n');
        mockBuffer.viewportVisualLines = text.split('\n');
        mockBuffer.visualCursor = [1, 0]; // cursor on the blank line
        mockBuffer.visualToLogicalMap = [
          [0, 0],
          [1, 0],
          [2, 0],
        ];

        const { stdout, unmount } = renderWithProviders(
          <InputPrompt {...props} />,
        );

        await waitFor(() => {
          const frame = stdout.lastFrame();
          const lines = frame!.split('\n');
          // The line with the cursor should just be an inverted space inside the box border
          expect(
            lines.find((l) => l.includes(chalk.inverse(' '))),
          ).not.toBeUndefined();
        });
        unmount();
      });
    });
  });

  describe('multiline rendering', () => {
    it('should correctly render multiline input including blank lines', async () => {
      const text = 'hello\n\nworld';
      mockBuffer.text = text;
      mockBuffer.lines = text.split('\n');
      mockBuffer.viewportVisualLines = text.split('\n');
      mockBuffer.allVisualLines = text.split('\n');
      mockBuffer.visualCursor = [2, 5]; // cursor at the end of "world"
      // Provide a visual-to-logical mapping for each visual line
      mockBuffer.visualToLogicalMap = [
        [0, 0], // 'hello' starts at col 0 of logical line 0
        [1, 0], // '' (blank) is logical line 1, col 0
        [2, 0], // 'world' is logical line 2, col 0
      ];

      const { stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await waitFor(() => {
        const frame = stdout.lastFrame();
        // Check that all lines, including the empty one, are rendered.
        // This implicitly tests that the Box wrapper provides height for the empty line.
        expect(frame).toContain('hello');
        expect(frame).toContain(`world${chalk.inverse(' ')}`);

        const outputLines = frame!.split('\n');
        // The number of lines should be 2 for the border plus 3 for the content.
        expect(outputLines.length).toBe(5);
      });
      unmount();
    });
  });

  describe('multiline paste', () => {
    it.each([
      {
        description: 'with \n newlines',
        pastedText: 'This \n is \n a \n multiline \n paste.',
      },
      {
        description: 'with extra slashes before \n newlines',
        pastedText: 'This \\\n is \\\n a \\\n multiline \\\n paste.',
      },
      {
        description: 'with \r\n newlines',
        pastedText: 'This\r\nis\r\na\r\nmultiline\r\npaste.',
      },
    ])('should handle multiline paste $description', async ({ pastedText }) => {
      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      // Simulate a bracketed paste event from the terminal
      await act(async () => {
        stdin.write(`\x1b[200~${pastedText}\x1b[201~`);
      });
      await waitFor(() => {
        // Verify that the buffer's handleInput was called once with the full text
        expect(props.buffer.handleInput).toHaveBeenCalledTimes(1);
        expect(props.buffer.handleInput).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'paste',
            sequence: pastedText,
          }),
        );
      });

      unmount();
    });
  });

  describe('paste auto-submission protection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockedUseKittyKeyboardProtocol.mockReturnValue({
        enabled: false,
        checking: false,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should prevent auto-submission immediately after an unsafe paste', async () => {
      // isTerminalPasteTrusted will be false due to beforeEach setup.
      props.buffer.text = 'some command';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Simulate a paste operation (this should set the paste protection)
      await act(async () => {
        stdin.write(`\x1b[200~pasted content\x1b[201~`);
      });

      // Simulate an Enter key press immediately after paste
      await act(async () => {
        stdin.write('\r');
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Verify that onSubmit was NOT called due to recent paste protection
      expect(props.onSubmit).not.toHaveBeenCalled();
      // It should call newline() instead
      expect(props.buffer.newline).toHaveBeenCalled();
      unmount();
    });

    it('should allow submission after unsafe paste protection timeout', async () => {
      // isTerminalPasteTrusted will be false due to beforeEach setup.
      props.buffer.text = 'pasted text';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Simulate a paste operation (this sets the protection)
      await act(async () => {
        stdin.write('\x1b[200~pasted text\x1b[201~');
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Advance timers past the protection timeout
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      // Now Enter should work normally
      await act(async () => {
        stdin.write('\r');
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(props.onSubmit).toHaveBeenCalledWith('pasted text');
      expect(props.buffer.newline).not.toHaveBeenCalled();

      unmount();
    });

    it.each([
      {
        name: 'kitty',
        setup: () =>
          mockedUseKittyKeyboardProtocol.mockReturnValue({
            enabled: true,
            checking: false,
          }),
      },
    ])(
      'should allow immediate submission for a trusted paste ($name)',
      async ({ setup }) => {
        setup();
        props.buffer.text = 'pasted command';

        const { stdin, unmount } = renderWithProviders(
          <InputPrompt {...props} />,
          { kittyProtocolEnabled: true },
        );
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        // Simulate a paste operation
        await act(async () => {
          stdin.write('\x1b[200~some pasted stuff\x1b[201~');
        });
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        // Simulate an Enter key press immediately after paste
        await act(async () => {
          stdin.write('\r');
        });
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        // Verify that onSubmit was called
        expect(props.onSubmit).toHaveBeenCalledWith('pasted command');
        unmount();
      },
    );

    it('should not interfere with normal Enter key submission when no recent paste', async () => {
      // Set up buffer with text before rendering to ensure submission works
      props.buffer.text = 'normal command';

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Press Enter without any recent paste
      await act(async () => {
        stdin.write('\r');
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Verify that onSubmit was called normally
      expect(props.onSubmit).toHaveBeenCalledWith('normal command');

      unmount();
    });
  });

  describe('enhanced input UX - double ESC clear functionality', () => {
    it('should do nothing on ESC when buffer is empty', async () => {
      const onEscapePromptChange = vi.fn();
      props.onEscapePromptChange = onEscapePromptChange;
      props.buffer.setText('');
      vi.mocked(props.buffer.setText).mockClear();

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      await act(async () => {
        stdin.write('\x1B');
      });

      await waitFor(() => {
        expect(props.buffer.setText).not.toHaveBeenCalled();
        expect(onEscapePromptChange).not.toHaveBeenCalledWith(true);
      });
      unmount();
    });

    it('should clear buffer on second ESC press', async () => {
      const onEscapePromptChange = vi.fn();
      props.onEscapePromptChange = onEscapePromptChange;
      props.buffer.setText('text to clear');

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      await act(async () => {
        stdin.write('\x1B');
        await waitFor(() => {
          expect(onEscapePromptChange).toHaveBeenCalledWith(false);
        });
      });

      await act(async () => {
        stdin.write('\x1B');
        await waitFor(() => {
          expect(props.buffer.setText).toHaveBeenCalledWith('');
          expect(mockCommandCompletion.resetCompletionState).toHaveBeenCalled();
        });
      });
      unmount();
    });

    it('should reset escape state on any non-ESC key', async () => {
      const onEscapePromptChange = vi.fn();
      props.onEscapePromptChange = onEscapePromptChange;
      props.buffer.setText('some text');

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      await act(async () => {
        stdin.write('\x1B');
        await waitFor(() => {
          expect(onEscapePromptChange).toHaveBeenCalledWith(false);
        });
      });

      await act(async () => {
        stdin.write('a');
        await waitFor(() => {
          expect(onEscapePromptChange).toHaveBeenCalledWith(false);
        });
      });
      unmount();
    });

    it('should handle ESC in shell mode by disabling shell mode', async () => {
      props.shellModeActive = true;

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      await act(async () => {
        stdin.write('\x1B');
        await waitFor(() =>
          expect(props.setShellModeActive).toHaveBeenCalledWith(false),
        );
      });
      unmount();
    });

    it('should handle ESC when completion suggestions are showing', async () => {
      mockedUseCommandCompletion.mockReturnValue({
        ...mockCommandCompletion,
        showSuggestions: true,
        suggestions: [{ label: 'suggestion', value: 'suggestion' }],
      });

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      await act(async () => {
        stdin.write('\x1B');
      });
      await waitFor(() =>
        expect(mockCommandCompletion.resetCompletionState).toHaveBeenCalled(),
      );
      unmount();
    });

    it('should not call onEscapePromptChange when not provided', async () => {
      vi.useFakeTimers();
      props.onEscapePromptChange = undefined;
      props.buffer.setText('some text');

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        stdin.write('\x1B');
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Passing undefined must be a safe no-op: clearing via replaceRange must
      // not happen as part of the escape-only-bubble path when the callback is
      // absent. (Pre-existing setText("some text") happened before render and
      // is excluded by checking the more specific buffer mutator.)
      expect(props.buffer.replaceRangeByOffset).not.toHaveBeenCalled();

      vi.useRealTimers();
      unmount();
    });

    it('should not interfere with existing keyboard shortcuts', async () => {
      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      await act(async () => {
        stdin.write('\x0C');
      });
      await waitFor(() => expect(props.onClearScreen).toHaveBeenCalled());

      await act(async () => {
        stdin.write('\x01');
      });
      await waitFor(() =>
        expect(props.buffer.move).toHaveBeenCalledWith('home'),
      );
      unmount();
    });
  });
});
