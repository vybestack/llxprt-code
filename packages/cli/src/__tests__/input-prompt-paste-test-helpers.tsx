/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installWorkspaceRuntimeFixture } from './workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import { ApprovalMode, type Config } from '@vybestack/llxprt-code-core';
import { automock } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from 'bun:test';
import { beforeEach, vi } from 'bun:test';
import * as path from 'node:path';
import { useCallback, useState, type FC } from 'react';
import {
  createMockCommandContext,
  type CommandOwnerFixture,
} from './mockCommandContext.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { CommandKind } from '../ui/commands/types.js';
import type { UseCommandCompletionReturn } from '../ui/hooks/useCommandCompletion.js';
import { useCommandCompletion } from '../ui/hooks/useCommandCompletion.js';
import { useInputHistory } from '../ui/hooks/useInputHistory.js';
import type { UseReverseSearchCompletionReturn } from '../ui/hooks/useReverseSearchCompletion.js';
import { useReverseSearchCompletion } from '../ui/hooks/useReverseSearchCompletion.js';
import type { UseShellHistoryReturn } from '../ui/hooks/useShellHistory.js';
import { useShellHistory } from '../ui/hooks/useShellHistory.js';
import { StreamingState } from '../ui/types.js';
import { terminalCapabilityManager } from '../ui/utils/terminalCapabilityManager.js';
import {
  InputPrompt,
  type InputPromptProps,
} from '../ui/components/InputPrompt.js';
import {
  useTextBuffer,
  type TextBuffer,
} from '../ui/components/shared/text-buffer.js';

const realUseShellHistoryModule = {
  ...(await import('../ui/hooks/useShellHistory.js')),
};
const realUseCommandCompletionModule = {
  ...(await import('../ui/hooks/useCommandCompletion.js')),
};
const realUseInputHistoryModule = {
  ...(await import('../ui/hooks/useInputHistory.js')),
};
const realUseReverseSearchCompletionModule = {
  ...(await import('../ui/hooks/useReverseSearchCompletion.js')),
};
const realClipboardUtilsModule = {
  ...(await import('../ui/utils/clipboardUtils.js')),
};

void vi.mock('../ui/hooks/useShellHistory.js', () =>
  automock(realUseShellHistoryModule),
);
void vi.mock('../ui/hooks/useCommandCompletion.js', () =>
  automock(realUseCommandCompletionModule),
);
void vi.mock('../ui/hooks/useInputHistory.js', () =>
  automock(realUseInputHistoryModule),
);
void vi.mock('../ui/hooks/useReverseSearchCompletion.js', () =>
  automock(realUseReverseSearchCompletionModule),
);
void vi.mock('../ui/utils/clipboardUtils.js', () =>
  automock(realClipboardUtilsModule),
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

export const InputPromptWithRealBuffer: FC<
  InputPromptProps & {
    readonly initialText?: string;
    readonly initialCursorOffset?: number;
  }
> = ({
  initialText = '',
  initialCursorOffset = initialText.length,
  ...props
}) => {
  const reportError = props.setQueueErrorMessage;
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(
    null,
  );
  const handleQueueErrorMessage = useCallback(
    (message: string | null): void => {
      setQueueErrorMessage(message);
      reportError?.(message);
    },
    [reportError],
  );
  const buffer = useTextBuffer({
    initialText,
    initialCursorOffset,
    viewport: { width: 80, height: 24 },
    isValidPath: () => false,
  });

  return (
    <InputPrompt
      {...props}
      buffer={buffer}
      queueErrorMessage={queueErrorMessage}
      setQueueErrorMessage={handleQueueErrorMessage}
    />
  );
};

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createBuffer(): TextBuffer {
  const mockBuffer = {
    text: '',
    cursor: [0, 0],
    lines: [''],
    // inputPromptRender indexes transformationsByLine and treats
    // visualToTransformedMap as a number; without both the component throws
    // while rendering.
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

  return mockBuffer;
}

function createCompletion(): UseCommandCompletionReturn {
  return {
    activeHint: '',
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
}

function createProps(
  buffer: TextBuffer,
  commandContext: CommandOwnerFixture,
): InputPromptProps {
  return {
    enableFuzzyFiltering: true,
    generatePromptContent: null,
    buffer,
    onSubmit: vi.fn(),
    userMessages: [],
    onClearScreen: vi.fn(),
    config: composeFixtureRuntime({
      getMcpServers: () => undefined,
      getProjectRoot: () => path.join('test', 'project'),
      getTargetDir: () => path.join('test', 'project', 'src'),
      getVimMode: () => false,
    } as unknown as Config),
    slashCommands: mockSlashCommands,
    commandContext,
    shellModeActive: false,
    setShellModeActive: vi.fn(),
    approvalMode: ApprovalMode.DEFAULT,
    inputWidth: 80,
    suggestionsWidth: 80,
    focus: true,
    setQueueErrorMessage: vi.fn(),
    streamingState: StreamingState.Idle,
  };
}

export function usePasteTestHarness() {
  let props: InputPromptProps;
  let mockShellHistory: UseShellHistoryReturn;
  let mockCommandCompletion: UseCommandCompletionReturn;
  let mockInputHistory: ReturnType<typeof useInputHistory>;
  let mockReverseSearchCompletion: UseReverseSearchCompletionReturn;
  let mockBuffer: TextBuffer;
  let mockCommandContext: CommandOwnerFixture;

  const mockedUseShellHistory = useShellHistory as Mock<typeof useShellHistory>;
  const mockedUseCommandCompletion = useCommandCompletion as Mock<
    typeof useCommandCompletion
  >;
  const mockedUseInputHistory = useInputHistory as Mock<typeof useInputHistory>;
  const mockedUseReverseSearchCompletion = useReverseSearchCompletion as Mock<
    typeof useReverseSearchCompletion
  >;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(
      terminalCapabilityManager,
      'isKittyProtocolEnabled',
    ).mockReturnValue(true);

    mockCommandContext = createMockCommandContext();

    mockBuffer = createBuffer();

    mockShellHistory = {
      history: [],
      addCommandToHistory: vi.fn(),
      getPreviousCommand: vi.fn().mockReturnValue(null),
      getNextCommand: vi.fn().mockReturnValue(null),
      resetHistoryPosition: vi.fn(),
    };
    mockedUseShellHistory.mockReturnValue(mockShellHistory);

    mockCommandCompletion = createCompletion();
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

    props = createProps(mockBuffer, mockCommandContext);
  });

  return {
    get props() {
      return props;
    },
    get mockCommandCompletion() {
      return mockCommandCompletion;
    },
    get mockReverseSearchCompletion() {
      return mockReverseSearchCompletion;
    },
    get mockedUseCommandCompletion() {
      return mockedUseCommandCompletion;
    },
    get mockedUseReverseSearchCompletion() {
      return mockedUseReverseSearchCompletion;
    },
  };
}
