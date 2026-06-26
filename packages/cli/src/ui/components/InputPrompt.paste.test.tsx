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
import stripAnsi from 'strip-ansi';
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

  describe('reverse search', () => {
    beforeEach(async () => {
      props.shellModeActive = true;

      vi.mocked(useShellHistory).mockReturnValue({
        history: ['echo hello', 'echo world', 'ls'],
        getPreviousCommand: vi.fn(),
        getNextCommand: vi.fn(),
        addCommandToHistory: vi.fn(),
        resetHistoryPosition: vi.fn(),
      });
    });

    it('invokes reverse search on Ctrl+R', async () => {
      // Mock the reverse search completion to return suggestions
      mockedUseReverseSearchCompletion.mockReturnValue({
        ...mockReverseSearchCompletion,
        suggestions: [
          { label: 'echo hello', value: 'echo hello' },
          { label: 'echo world', value: 'echo world' },
          { label: 'ls', value: 'ls' },
        ],
        showSuggestions: true,
        activeSuggestionIndex: 0,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      // Trigger reverse search with Ctrl+R
      await act(async () => {
        stdin.write('\x12');
      });

      await waitFor(() => {
        const frame = stdout.lastFrame();
        expect(frame).toContain('(r:)');
        expect(frame).toContain('echo hello');
        expect(frame).toContain('echo world');
        expect(frame).toContain('ls');
      });

      unmount();
    });

    it.each([
      { name: 'standard', kittyProtocolEnabled: false, escapeSequence: '\x1B' },
      {
        name: 'kitty',
        kittyProtocolEnabled: true,
        escapeSequence: '\u001b[27u',
      },
    ])(
      'resets reverse search state on Escape ($name)',
      async ({ kittyProtocolEnabled, escapeSequence }) => {
        const { stdin, stdout, unmount } = renderWithProviders(
          <InputPrompt {...props} />,
          { kittyProtocolEnabled },
        );

        await act(async () => {
          stdin.write('\x12');
        });

        // Wait for reverse search to be active
        await waitFor(() => {
          expect(stdout.lastFrame()).toContain('(r:)');
        });

        await act(async () => {
          stdin.write(escapeSequence);
        });

        await waitFor(() => {
          expect(stdout.lastFrame()).not.toContain('(r:)');
          expect(stdout.lastFrame()).not.toContain('echo hello');
        });

        unmount();
      },
    );

    it('completes the highlighted entry on Tab and exits reverse-search', async () => {
      // Mock the reverse search completion
      const mockHandleAutocomplete = vi.fn(() => {
        props.buffer.setText('echo hello');
      });

      mockedUseReverseSearchCompletion.mockImplementation(
        (buffer, shellHistory, reverseSearchActive) => ({
          ...mockReverseSearchCompletion,
          suggestions: reverseSearchActive
            ? [
                { label: 'echo hello', value: 'echo hello' },
                { label: 'echo world', value: 'echo world' },
                { label: 'ls', value: 'ls' },
              ]
            : [],
          showSuggestions: reverseSearchActive,
          activeSuggestionIndex: reverseSearchActive ? 0 : -1,
          handleAutocomplete: mockHandleAutocomplete,
        }),
      );

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      // Enter reverse search mode with Ctrl+R
      await act(async () => {
        stdin.write('\x12');
      });

      // Verify reverse search is active
      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('(r:)');
      });

      // Press Tab to complete the highlighted entry
      await act(async () => {
        stdin.write('\t');
      });
      await waitFor(() => {
        expect(mockHandleAutocomplete).toHaveBeenCalledWith(0);
        expect(props.buffer.setText).toHaveBeenCalledWith('echo hello');
      });
      unmount();
    }, 15000);

    it('submits the highlighted entry on Enter and exits reverse-search', async () => {
      // Mock the reverse search completion to return suggestions
      mockedUseReverseSearchCompletion.mockReturnValue({
        ...mockReverseSearchCompletion,
        suggestions: [
          { label: 'echo hello', value: 'echo hello' },
          { label: 'echo world', value: 'echo world' },
          { label: 'ls', value: 'ls' },
        ],
        showSuggestions: true,
        activeSuggestionIndex: 0,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('(r:)');
      });

      await act(async () => {
        stdin.write('\r');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).not.toContain('(r:)');
      });

      expect(props.onSubmit).toHaveBeenCalledWith('echo hello');
      unmount();
    });

    it('should restore text and cursor position after reverse search', async () => {
      const initialText = 'initial text';
      const initialCursor: [number, number] = [0, 3];

      props.buffer.setText(initialText);
      props.buffer.cursor = initialCursor;

      // Mock the reverse search completion to be active and then reset
      mockedUseReverseSearchCompletion.mockImplementation(
        (buffer, shellHistory, reverseSearchActiveFromInputPrompt) => ({
          ...mockReverseSearchCompletion,
          suggestions: reverseSearchActiveFromInputPrompt
            ? [{ label: 'history item', value: 'history item' }]
            : [],
          showSuggestions: reverseSearchActiveFromInputPrompt,
        }),
      );

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      // reverse search with Ctrl+R
      await act(async () => {
        stdin.write('\x12');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).toContain('(r:)');
      });

      // Press kitty escape key
      await act(async () => {
        stdin.write('\u001b[27u');
      });

      await waitFor(() => {
        expect(stdout.lastFrame()).not.toContain('(r:)');
        expect(props.buffer.text).toBe(initialText);
        expect(props.buffer.cursor).toStrictEqual(initialCursor);
      });

      unmount();
    });
  });

  describe('Ctrl+E keyboard shortcut', () => {
    it('should move cursor to end of current line in multiline input', async () => {
      props.buffer.text = 'line 1\nline 2\nline 3';
      props.buffer.cursor = [1, 2];
      props.buffer.lines = ['line 1', 'line 2', 'line 3'];

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x05'); // Ctrl+E
      });
      await waitFor(() => {
        expect(props.buffer.move).toHaveBeenCalledWith('end');
      });
      expect(props.buffer.moveToOffset).not.toHaveBeenCalled();
      unmount();
    });

    it('should move cursor to end of current line for single line input', async () => {
      props.buffer.text = 'single line text';
      props.buffer.cursor = [0, 5];
      props.buffer.lines = ['single line text'];

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x05'); // Ctrl+E
      });
      await waitFor(() => {
        expect(props.buffer.move).toHaveBeenCalledWith('end');
      });
      expect(props.buffer.moveToOffset).not.toHaveBeenCalled();
      unmount();
    });
  });

  describe('command search (Ctrl+R when not in shell)', () => {
    it('enters command search on Ctrl+R and shows suggestions', async () => {
      props.shellModeActive = false;

      vi.mocked(useReverseSearchCompletion).mockImplementation(
        (buffer, data, isActive) => ({
          ...mockReverseSearchCompletion,
          suggestions: isActive
            ? [
                { label: 'git commit -m "msg"', value: 'git commit -m "msg"' },
                { label: 'git push', value: 'git push' },
              ]
            : [],
          showSuggestions: !!isActive,
          activeSuggestionIndex: isActive ? 0 : -1,
        }),
      );

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x12'); // Ctrl+R
      });

      await waitFor(() => {
        const frame = stdout.lastFrame() ?? '';
        expect(frame).toContain('(r:)');
        expect(frame).toContain('git commit');
        expect(frame).toContain('git push');
      });
      unmount();
    });

    it('expands and collapses long suggestion via Right/Left arrows', async () => {
      props.shellModeActive = false;
      const longValue = 'l'.repeat(200);

      vi.mocked(useReverseSearchCompletion).mockReturnValue({
        ...mockReverseSearchCompletion,
        suggestions: [{ label: longValue, value: longValue, matchedIndex: 0 }],
        showSuggestions: true,
        activeSuggestionIndex: 0,
        visibleStartIndex: 0,
        isLoadingSuggestions: false,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });
      await waitFor(() => {
        expect(clean(stdout.lastFrame())).toContain('→');
      });

      await act(async () => {
        stdin.write('\u001B[C');
      });
      await waitFor(() => {
        expect(clean(stdout.lastFrame())).toContain('←');
      });
      expect(stdout.lastFrame()).toMatchSnapshot(
        'command-search-render-expanded-match',
      );

      await act(async () => {
        stdin.write('\u001B[D');
      });
      await waitFor(() => {
        expect(clean(stdout.lastFrame())).toContain('→');
      });
      expect(stdout.lastFrame()).toMatchSnapshot(
        'command-search-render-collapsed-match',
      );
      unmount();
    });

    it('renders match window and expanded view (snapshots)', async () => {
      props.shellModeActive = false;
      props.buffer.setText('commit');

      const label = 'git commit -m "feat: add search" in src/app';
      const matchedIndex = label.indexOf('commit');

      vi.mocked(useReverseSearchCompletion).mockReturnValue({
        ...mockReverseSearchCompletion,
        suggestions: [{ label, value: label, matchedIndex }],
        showSuggestions: true,
        activeSuggestionIndex: 0,
        visibleStartIndex: 0,
        isLoadingSuggestions: false,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });
      await waitFor(() => {
        expect(stdout.lastFrame()).toMatchSnapshot(
          'command-search-render-collapsed-match',
        );
      });

      await act(async () => {
        stdin.write('\u001B[C');
      });
      await waitFor(() => {
        expect(stdout.lastFrame()).toMatchSnapshot(
          'command-search-render-expanded-match',
        );
      });

      unmount();
    });

    it('does not show expand/collapse indicator for short suggestions', async () => {
      props.shellModeActive = false;
      const shortValue = 'echo hello';

      vi.mocked(useReverseSearchCompletion).mockReturnValue({
        ...mockReverseSearchCompletion,
        suggestions: [{ label: shortValue, value: shortValue }],
        showSuggestions: true,
        activeSuggestionIndex: 0,
        visibleStartIndex: 0,
        isLoadingSuggestions: false,
      });

      const { stdin, stdout, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
      );

      await act(async () => {
        stdin.write('\x12');
      });
      await waitFor(() => {
        const frame = clean(stdout.lastFrame());
        // Ensure it rendered the search mode
        expect(frame).toContain('(r:)');
        expect(frame).not.toContain('→');
        expect(frame).not.toContain('←');
      });
      unmount();
    });
  });

  describe('Tab focus toggle', () => {
    it.each([
      {
        name: 'should toggle focus in on Tab when no suggestions or ghost text',
        showSuggestions: false,
        ghostText: '',
        suggestions: [],
        expectedFocusToggle: true,
      },
      {
        name: 'should accept ghost text and NOT toggle focus on Tab',
        showSuggestions: false,
        ghostText: 'ghost text',
        suggestions: [],
        expectedFocusToggle: false,
        expectedAcceptCall: true,
      },
      {
        name: 'should NOT toggle focus on Tab when suggestions are present',
        showSuggestions: true,
        ghostText: '',
        suggestions: [{ label: 'test', value: 'test' }],
        expectedFocusToggle: false,
      },
    ])(
      '$name',
      async ({
        showSuggestions,
        ghostText,
        suggestions,
        expectedFocusToggle,
        expectedAcceptCall,
      }) => {
        const mockAccept = vi.fn();
        mockedUseCommandCompletion.mockReturnValue({
          ...mockCommandCompletion,
          showSuggestions,
          suggestions,
          promptCompletion: {
            text: ghostText,
            accept: mockAccept,
            clear: vi.fn(),
            isLoading: false,
            isActive: ghostText !== '',
            markSelected: vi.fn(),
          },
        });

        const { stdin, unmount } = renderWithProviders(
          <InputPrompt {...props} />,
          {
            uiActions,
            uiState: { activePtyId: 1 },
          },
        );

        await act(async () => {
          stdin.write('\t');
        });

        await waitFor(() => {
          // When focus toggles, the action is invoked exactly once with `true`;
          // otherwise it must not be called at all.
          expect(uiActions.setEmbeddedShellFocused.mock.calls).toStrictEqual(
            expectedFocusToggle ? [[true]] : [],
          );

          expect(mockAccept).toHaveBeenCalledTimes(
            expectedAcceptCall === true ? 1 : 0,
          );
        });
        unmount();
      },
    );
  });

  describe('mouse interaction', () => {
    it.each([
      {
        name: 'first line, first char',
        relX: 0,
        relY: 0,
        mouseCol: 5,
        mouseRow: 2,
      },
      {
        name: 'first line, middle char',
        relX: 6,
        relY: 0,
        mouseCol: 11,
        mouseRow: 2,
      },
      {
        name: 'second line, first char',
        relX: 0,
        relY: 1,
        mouseCol: 5,
        mouseRow: 3,
      },
      {
        name: 'second line, end char',
        relX: 5,
        relY: 1,
        mouseCol: 10,
        mouseRow: 3,
      },
    ])(
      'should move cursor on mouse click - $name',
      async ({ relX, relY, mouseCol, mouseRow }) => {
        props.buffer.text = 'hello world\nsecond line';
        props.buffer.lines = ['hello world', 'second line'];
        props.buffer.viewportVisualLines = ['hello world', 'second line'];
        props.buffer.visualToLogicalMap = [
          [0, 0],
          [1, 0],
        ];
        props.buffer.visualCursor = [0, 11];
        props.buffer.visualScrollRow = 0;

        const { stdin, stdout, unmount } = renderWithProviders(
          <InputPrompt {...props} />,
          { mouseEventsEnabled: true },
        );

        // Wait for initial render
        await waitFor(() => {
          expect(stdout.lastFrame()).toContain('hello world');
        });

        // Simulate left mouse press at calculated coordinates.
        // Assumes inner box is at x=4, y=1 based on border(1)+padding(1)+prompt(2) and border-top(1).
        await act(async () => {
          stdin.write(`\x1b[<0;${mouseCol};${mouseRow}M`);
        });

        await waitFor(() => {
          expect(props.buffer.moveToVisualPosition).toHaveBeenCalledWith(
            relY,
            relX,
          );
        });

        unmount();
      },
    );
  });
});

function clean(str: string | undefined): string {
  if (!str) return '';
  // Remove ANSI escape codes and trim whitespace
  return stripAnsi(str).trim();
}
