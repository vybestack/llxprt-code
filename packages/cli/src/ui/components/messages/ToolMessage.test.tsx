/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolMessageProps } from './ToolMessage.js';
import { ToolMessage } from './ToolMessage.js';
import { StreamingState, ToolCallStatus } from '../../types.js';
import { Text } from 'ink';
import { StreamingContext } from '../../contexts/StreamingContext.js';
import { renderWithProviders } from '../../../test-utils/render.js';
import { Colors } from '../../colors.js';
import { TOOL_STATUS } from '../../constants.js';
import type { AnsiOutput, Config } from '@vybestack/llxprt-code-core';

const isActivePtyMock = vi.hoisted(() => vi.fn());
const getLastActivePtyIdMock = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');

  return {
    ...actual,
    ShellExecutionService: {
      ...actual.ShellExecutionService,
      isActivePty: isActivePtyMock,
      getLastActivePtyId: getLastActivePtyIdMock,
    },
  };
});

vi.mock('../GeminiRespondingSpinner.js', () => ({
  GeminiRespondingSpinner: ({
    nonRespondingDisplay,
  }: {
    nonRespondingDisplay?: string;
  }) => {
    const streamingState = React.useContext(StreamingContext)!;
    if (streamingState === StreamingState.Responding) {
      return <Text color={Colors.Foreground}>MockRespondingSpinner</Text>;
    }
    return nonRespondingDisplay ? (
      <Text color={Colors.Foreground}>{nonRespondingDisplay}</Text>
    ) : null;
  },
}));
vi.mock('./DiffRenderer.js', () => ({
  DiffRenderer: function MockDiffRenderer({
    diffContent,
  }: {
    diffContent: string;
  }) {
    return <Text color={Colors.Foreground}>MockDiff:{diffContent}</Text>;
  },
}));
vi.mock('../../utils/MarkdownDisplay.js', () => ({
  MarkdownDisplay: function MockMarkdownDisplay({ text }: { text: string }) {
    return <Text color={Colors.Foreground}>MockMarkdown:{text}</Text>;
  },
}));
vi.mock('../ShellInputPrompt.js', () => ({
  ShellInputPrompt: ({ focus }: { focus: boolean }) =>
    focus ? React.createElement(Text, null, 'MockShellInput') : null,
}));

const renderWithContext = (
  ui: React.ReactElement,
  streamingState: StreamingState,
) => {
  const contextValue: StreamingState = streamingState;
  return renderWithProviders(
    <StreamingContext.Provider value={contextValue}>
      {ui}
    </StreamingContext.Provider>,
  );
};

describe('<ToolMessage />', () => {
  const baseProps: ToolMessageProps = {
    callId: 'tool-123',
    name: 'test-tool',
    description: 'A tool for testing',
    resultDisplay: 'Test result',
    status: ToolCallStatus.Success,
    terminalWidth: 80,
    confirmationDetails: undefined,
    emphasis: 'medium',
  };

  describe('ToolStatusIndicator rendering', () => {
    it('shows SUCCESS indicator for Success status', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Success} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain(TOOL_STATUS.SUCCESS);
    });

    it('shows o for Pending status', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Pending} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('o');
    });

    it('shows ? for Confirming status', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Confirming} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('?');
    });

    it('shows - for Canceled status', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Canceled} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('-');
    });

    it('shows x for Error status', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Error} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('x');
    });

    it('shows paused spinner for Executing status when streamingState is Idle', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Executing} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain(TOOL_STATUS.EXECUTING);
      expect(lastFrame()).not.toContain('MockRespondingSpinner');
      expect(lastFrame()).not.toContain(TOOL_STATUS.SUCCESS);
    });

    it('shows paused spinner for Executing status when streamingState is WaitingForConfirmation', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Executing} />,
        StreamingState.WaitingForConfirmation,
      );
      expect(lastFrame()).toContain(TOOL_STATUS.EXECUTING);
      expect(lastFrame()).not.toContain('MockRespondingSpinner');
      expect(lastFrame()).not.toContain(TOOL_STATUS.SUCCESS);
    });

    it('shows MockRespondingSpinner for Executing status when streamingState is Responding', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Executing} />,
        StreamingState.Responding,
      );
      expect(lastFrame()).toContain('MockRespondingSpinner');
      expect(lastFrame()).not.toContain(TOOL_STATUS.SUCCESS);
    });
  });

  describe('ctrl+r hint display', () => {
    it('does not show "Press ctrl+r" hint when not Executing', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Success} />,
        StreamingState.Idle,
      );
      expect(lastFrame()).not.toContain("Press 'ctrl+r'");
    });
  });

  it('renders DiffRenderer for diff results', () => {
    const diffResult = {
      fileDiff: '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new',
      fileName: 'file.txt',
      originalContent: 'old',
      newContent: 'new',
      filePath: 'file.txt',
    };
    const { lastFrame } = renderWithContext(
      <ToolMessage {...baseProps} resultDisplay={diffResult} />,
      StreamingState.Idle,
    );
    // Check that the output contains the MockDiff content as part of the whole message
    expect(lastFrame()).toMatchSnapshot();
  });

  it('renders emphasis correctly', () => {
    const { lastFrame: highEmphasisFrame } = renderWithContext(
      <ToolMessage {...baseProps} emphasis="high" />,
      StreamingState.Idle,
    );
    // Check for trailing indicator or specific color if applicable (Colors are not easily testable here)
    expect(highEmphasisFrame()).toMatchSnapshot();

    const { lastFrame: lowEmphasisFrame } = renderWithContext(
      <ToolMessage {...baseProps} emphasis="low" />,
      StreamingState.Idle,
    );
    // For low emphasis, the name and description might be dimmed (check for dimColor if possible)
    // This is harder to assert directly in text output without color checks.
    // We can at least ensure it doesn't have the high emphasis indicator.
    expect(lowEmphasisFrame()).toMatchSnapshot();
  });

  it('renders AnsiOutputText for AnsiOutput results', () => {
    const ansiResult: AnsiOutput = [
      [
        {
          text: 'hello',
          fg: '#ffffff',
          bg: '#000000',
          bold: false,
          italic: false,
          underline: false,
          dim: false,
          inverse: false,
        },
      ],
    ];
    const { lastFrame } = renderWithContext(
      <ToolMessage {...baseProps} resultDisplay={ansiResult} />,
      StreamingState.Idle,
    );
    expect(lastFrame()).toMatchSnapshot();
  });

  describe('shell focus state for completed shell with live PTY', () => {
    const shellConfig = {
      getEnableInteractiveShell: () => true,
    } as unknown as Config;

    beforeEach(() => {
      isActivePtyMock.mockReturnValue(false);
      getLastActivePtyIdMock.mockReturnValue(null);
    });

    it('shows focused indicator for executing shell with matching ptyId', () => {
      getLastActivePtyIdMock.mockReturnValue(42);
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="Shell"
          status={ToolCallStatus.Executing}
          ptyId={42}
          activeShellPtyId={42}
          embeddedShellFocused={true}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('Focused');
    });

    it('shows focusable indicator for executing shell even when not focused', () => {
      getLastActivePtyIdMock.mockReturnValue(42);
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="Shell"
          status={ToolCallStatus.Executing}
          ptyId={42}
          activeShellPtyId={42}
          embeddedShellFocused={false}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('Tab/Ctrl+F to focus');
      expect(lastFrame()).not.toContain('Focused');
    });

    it('shows focused indicator for completed shell when PTY is still alive and embeddedShellFocused is true', () => {
      getLastActivePtyIdMock.mockReturnValue(42);
      isActivePtyMock.mockReturnValue(true);
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="Shell"
          status={ToolCallStatus.Success}
          ptyId={42}
          activeShellPtyId={42}
          embeddedShellFocused={true}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('Focused');
    });

    it('does not show focused indicator for completed shell when PTY is dead', () => {
      getLastActivePtyIdMock.mockReturnValue(42);
      isActivePtyMock.mockReturnValue(false);
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="Shell"
          status={ToolCallStatus.Success}
          ptyId={42}
          activeShellPtyId={42}
          embeddedShellFocused={true}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).not.toContain('Focused');
      expect(lastFrame()).not.toContain('Tab/Ctrl+F to focus');
    });

    it('does not show focused indicator for non-shell tool', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="ReadFile"
          status={ToolCallStatus.Success}
          ptyId={42}
          embeddedShellFocused={true}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).not.toContain('Focused');
      expect(lastFrame()).not.toContain('Tab/Ctrl+F to focus');
    });

    it('shows focusable indicator for completed shell when PTY is alive but not focused', () => {
      getLastActivePtyIdMock.mockReturnValue(42);
      isActivePtyMock.mockReturnValue(true);
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="Shell"
          status={ToolCallStatus.Success}
          ptyId={42}
          activeShellPtyId={42}
          embeddedShellFocused={false}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('Tab/Ctrl+F to focus');
      expect(lastFrame()).not.toContain('Focused');
    });

    it('shows ShellInputPrompt for completed shell when PTY alive and focused', () => {
      getLastActivePtyIdMock.mockReturnValue(42);
      isActivePtyMock.mockReturnValue(true);
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name="Shell"
          status={ToolCallStatus.Success}
          ptyId={42}
          activeShellPtyId={42}
          embeddedShellFocused={true}
          config={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('MockShellInput');
    });
  });
});
