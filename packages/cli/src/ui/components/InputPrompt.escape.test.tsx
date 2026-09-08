/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act, useState } from 'react';
import type { InputPromptProps } from './InputPrompt.js';
import { InputPrompt } from './InputPrompt.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import * as path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
  type Mock,
} from 'bun:test';
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

describe('InputPrompt', () => {
  let props: InputPromptProps;
  let mockShellHistory: UseShellHistoryReturn;
  let mockCommandCompletion: UseCommandCompletionReturn;
  let mockInputHistory: UseInputHistoryReturn;
  let mockReverseSearchCompletion: UseReverseSearchCompletionReturn;
  let mockBuffer: TextBuffer;
  let mockCommandContext: CommandContext;

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
      setText: vi.fn((newText: string) => {
        mockBuffer.text = newText;
        mockBuffer.lines = [newText];
        mockBuffer.transformationsByLine = [[]];
        mockBuffer.visualToTransformedMap = [0];
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
      activeHint: '',
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

  describe('escape priority ordering', () => {
    const temporaryDirs: string[] = [];

    afterEach(() => {
      for (const dir of temporaryDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('closes shell path suggestions while leaving shell mode active', async () => {
      // Complete against a small dedicated directory rather than the repo
      // root: a real scan of the workspace is slow and its listing (and
      // therefore the suggestion shown) varies with the checkout.
      const completionRoot = mkdtempSync(
        path.join(tmpdir(), 'issue2018-shellpath-'),
      );
      temporaryDirs.push(completionRoot);
      mkdirSync(path.join(completionRoot, 'zebrafolder'));
      const shellModeCalls: boolean[] = [];
      props.shellModeActive = true;
      props.buffer.setText('./zebra');
      props.config.getTargetDir = () => completionRoot;
      props.setShellModeActive = (active) => {
        shellModeCalls.push(active);
      };
      const rendered = renderWithProviders(<InputPrompt {...props} />);
      await waitFor(() =>
        expect(rendered.stdout.lastFrame()).toContain('zebrafolder'),
      );

      rendered.stdin.write('\x1B');

      await waitFor(() => {
        expect(rendered.stdout.lastFrame()).not.toContain('zebrafolder');
      });
      expect(shellModeCalls).not.toContain(false);
      rendered.unmount();
    });

    it('dismisses slash suggestions without changing input or arming clear', async () => {
      const bufferText = '/cl';
      let escapePromptVisible = false;
      mockedUseCommandCompletion.mockImplementation(() => {
        const [showSuggestions, setShowSuggestions] = useState(true);
        return {
          ...mockCommandCompletion,
          showSuggestions,
          suggestions: [{ label: 'clear', value: '/clear' }],
          resetCompletionState: () => {
            setShowSuggestions(false);
          },
        };
      });
      props.buffer.setText(bufferText);
      props.onEscapePromptChange = (visible) => {
        escapePromptVisible = visible;
      };
      const rendered = renderWithProviders(<InputPrompt {...props} />);
      await waitFor(() => {
        expect(rendered.stdout.lastFrame()).toContain('clear');
      });

      await act(async () => {
        rendered.stdin.write('\x1B');
      });

      await waitFor(() => {
        expect(rendered.stdout.lastFrame()).not.toContain('clear');
      });
      expect(props.buffer.text).toBe(bufferText);
      expect(escapePromptVisible).toBe(false);
      rendered.unmount();
    });
  });
});
