/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  automock,
  advanceTimersByTimeAsync,
  runAllTimersAsync,
} from '@vybestack/llxprt-code-test-utils';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import { ESC_TIMEOUT } from '../contexts/KeypressContext.js';
import type { InputPromptProps } from './InputPrompt.js';
import { InputPrompt } from './InputPrompt.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import * as path from 'node:path';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
import { describe, it, expect, beforeEach, vi, type Mock } from 'bun:test';
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

const realUseShellHistoryModule = {
  ...(await import('../hooks/useShellHistory.js')),
};
const realUseCommandCompletionModule = {
  ...(await import('../hooks/useCommandCompletion.js')),
};
const realUseInputHistoryModule = {
  ...(await import('../hooks/useInputHistory.js')),
};
const realUseReverseSearchCompletionModule = {
  ...(await import('../hooks/useReverseSearchCompletion.js')),
};
const realClipboardUtilsModule = {
  ...(await import('../utils/clipboardUtils.js')),
};
const realUseKittyKeyboardProtocolModule = {
  ...(await import('../hooks/useKittyKeyboardProtocol.js')),
};

void vi.mock('../hooks/useShellHistory.js', () =>
  automock(realUseShellHistoryModule),
);
void vi.mock('../hooks/useCommandCompletion.js', () =>
  automock(realUseCommandCompletionModule),
);
void vi.mock('../hooks/useInputHistory.js', () =>
  automock(realUseInputHistoryModule),
);
void vi.mock('../hooks/useReverseSearchCompletion.js', () =>
  automock(realUseReverseSearchCompletionModule),
);
void vi.mock('../utils/clipboardUtils.js', () =>
  automock(realClipboardUtilsModule),
);
void vi.mock('../hooks/useKittyKeyboardProtocol.js', () =>
  automock(realUseKittyKeyboardProtocolModule),
);

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

/**
 * Double-ESC clear behaviour for the input prompt.
 *
 * Split out of InputPrompt.completion.test.tsx, which #2019 and #2018 both
 * grew past the 800-line max-lines budget. The shared setup is duplicated so
 * the two suites stay independent.
 */
describe('InputPrompt', () => {
  let props: InputPromptProps;
  let mockShellHistory: UseShellHistoryReturn;
  let mockCommandCompletion: UseCommandCompletionReturn;
  let mockInputHistory: UseInputHistoryReturn;
  let mockReverseSearchCompletion: UseReverseSearchCompletionReturn;
  let mockBuffer: TextBuffer;
  let mockCommandContext: CommandContext;
  // The buffer's setText spy, held under its Mock type so tests can inspect
  // call history without casting the TextBuffer-typed field.
  let setTextMock: Mock<(newText: string) => void>;

  const mockedUseShellHistory = useShellHistory as Mock<typeof useShellHistory>;
  const mockedUseCommandCompletion = useCommandCompletion as Mock<
    typeof useCommandCompletion
  >;
  const mockedUseInputHistory = useInputHistory as Mock<typeof useInputHistory>;
  const mockedUseReverseSearchCompletion = useReverseSearchCompletion as Mock<
    typeof useReverseSearchCompletion
  >;
  const mockedUseKittyKeyboardProtocol = useKittyKeyboardProtocol as Mock<
    typeof useKittyKeyboardProtocol
  >;

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
      transformationsByLine: [[]],
      visualToTransformedMap: [0],
      setText: (setTextMock = vi.fn((newText: string) => {
        mockBuffer.text = newText;
        mockBuffer.lines = [newText];
        mockBuffer.transformationsByLine = [[]];
        mockBuffer.visualToTransformedMap = [0];
        mockBuffer.cursor = [0, newText.length];
        mockBuffer.viewportVisualLines = [newText];
        mockBuffer.allVisualLines = [newText];
        mockBuffer.visualToLogicalMap = [[0, 0]];
      })),
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

  describe('enhanced input UX - double ESC clear functionality', () => {
    it('should do nothing on ESC when buffer is empty', async () => {
      const onEscapePromptChange = vi.fn();
      props.onEscapePromptChange = onEscapePromptChange;
      props.buffer.setText('');
      (props.buffer.setText as Mock<typeof props.buffer.setText>).mockClear();

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
      vi.useFakeTimers();
      const onEscapePromptChange = vi.fn();
      props.onEscapePromptChange = onEscapePromptChange;
      // Seed the buffer, then clear the spy so the later assertions are about
      // the ESC-driven clear rather than this setup call.
      props.buffer.setText('text to clear');
      setTextMock.mockClear();

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      try {
        // Disregard the mount-time onEscapePromptChange(false) so the assertions
        // below can only be satisfied by the ESC keypresses.
        expect(onEscapePromptChange).toHaveBeenCalledWith(false);
        onEscapePromptChange.mockClear();

        // A lone ESC byte is decoded as an "escape" key only after the parser's
        // ESC_TIMEOUT flush. Fake timers let each flush be advanced exactly, so
        // the total elapsed time (2 x (ESC_TIMEOUT + 10) = 220ms) never reaches
        // the 500ms auto-reset deadline that the first press arms: the second
        // press is guaranteed to land while the prompt is still armed on every
        // schedule, rather than only when the machine is fast. waitFor is
        // deliberately not used here: its polling advances the fake clock, and
        // advancing past the 500ms deadline is exactly what must not happen.
        await act(async () => {
          stdin.write('\x1B');
          await advanceTimersByTimeAsync(ESC_TIMEOUT + 10);
        });
        expect(onEscapePromptChange).toHaveBeenCalledWith(true);

        // Arming must leave the buffer and completion state untouched: the
        // clear belongs to the second press alone. Without this check a broken
        // first-press clear followed by a no-op second press would still pass.
        expect(props.buffer.setText).not.toHaveBeenCalledWith('');
        expect(
          mockCommandCompletion.resetCompletionState,
        ).not.toHaveBeenCalled();

        await act(async () => {
          stdin.write('\x1B');
          await advanceTimersByTimeAsync(ESC_TIMEOUT + 10);
        });

        expect(props.buffer.setText).toHaveBeenCalledWith('');
        expect(mockCommandCompletion.resetCompletionState).toHaveBeenCalled();
      } finally {
        // Restore real timers even when an assertion fails: leaked fake timers
        // stall every later test in the file that depends on real time.
        vi.useRealTimers();
        unmount();
      }
    });

    it('should reset escape state on any non-ESC key', async () => {
      vi.useFakeTimers();
      const onEscapePromptChange = vi.fn();
      props.onEscapePromptChange = onEscapePromptChange;
      props.buffer.setText('some text');
      setTextMock.mockClear();

      const { stdin, unmount } = renderWithProviders(
        <InputPrompt {...props} />,
        { kittyProtocolEnabled: false },
      );

      try {
        // Disregard the mount-time onEscapePromptChange(false); every assertion
        // below must be satisfied by the keypresses, not by mounting.
        expect(onEscapePromptChange).toHaveBeenCalledWith(false);
        onEscapePromptChange.mockClear();

        // First ESC on a non-empty buffer arms the escape prompt.
        await act(async () => {
          stdin.write('\x1B');
          await advanceTimersByTimeAsync(ESC_TIMEOUT + 10);
        });
        expect(onEscapePromptChange).toHaveBeenCalledWith(true);

        // 'a' must reset the armed state. The clock stands at
        // ESC_TIMEOUT + 10 ms of the 500 ms auto-reset window and is not
        // advanced again before this assertion (no waitFor: its polling
        // advances the fake clock), so this false can only come from the
        // non-ESC keypress branch — the arming timer cannot expire and supply
        // it, whatever the machine's scheduling does.
        await act(async () => {
          stdin.write('a');
        });
        expect(onEscapePromptChange).toHaveBeenCalledWith(false);

        // Still inside the 500 ms window, a fresh ESC must re-arm rather than
        // clear: 'a' reset the press pair, so this press is a "first" press.
        await act(async () => {
          stdin.write('\x1B');
          await advanceTimersByTimeAsync(ESC_TIMEOUT + 10);
        });
        expect(onEscapePromptChange).toHaveBeenCalledWith(true);

        expect(
          onEscapePromptChange.mock.calls.map((call) => call[0]),
        ).toStrictEqual([true, false, true]);
        // The buffer surviving is the strongest proof the reset happened: had
        // 'a' not reset, this final press would have been the second of the
        // armed pair and would have cleared the buffer.
        expect(props.buffer.setText).not.toHaveBeenCalledWith('');
      } finally {
        // Restore real timers even when an assertion fails: leaked fake timers
        // stall every later test in the file that depends on real time.
        vi.useRealTimers();
        unmount();
      }
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
        await runAllTimersAsync();
      });

      await act(async () => {
        stdin.write('\x1B');
      });
      await act(async () => {
        await runAllTimersAsync();
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
