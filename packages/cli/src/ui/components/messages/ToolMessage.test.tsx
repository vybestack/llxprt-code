/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import type { ToolMessageProps } from './ToolMessage.js';
import { ToolMessage } from './ToolMessage.js';
import { StreamingState, ToolCallStatus } from '../../types.js';
import { Text } from 'ink';
import { StreamingContext } from '../../contexts/StreamingContext.js';
import { ShellCommandDisplayProvider } from '../../contexts/ShellCommandDisplayContext.js';
import { KeypressProvider } from '../../contexts/KeypressContext.js';
import { MouseProvider } from '../../contexts/MouseContext.js';
import { SettingsContext } from '../../contexts/SettingsContext.js';
import { UIStateContext, type UIState } from '../../contexts/UIStateContext.js';
import {
  createMockSettings,
  render as actRender,
  renderWithProviders,
} from '../../../test-utils/render.js';
import { Colors } from '../../colors.js';
import { SHELL_COMMAND_NAME, TOOL_STATUS } from '../../constants.js';
import type { AnsiOutput } from '@vybestack/llxprt-code-core';
import type { ShellState } from '../../cliUiRuntime.js';

const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

const isActivePtyMock = vi.fn();
const getLastActivePtyIdMock = vi.fn();

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;

  return {
    ...actual,
    ShellExecutionService: {
      ...actual.ShellExecutionService,
      isActivePty: isActivePtyMock,
      getLastActivePtyId: getLastActivePtyIdMock,
    },
  };
});

void vi.mock('../RespondingSpinner.js', () => ({
  RespondingSpinner: ({
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
void vi.mock('./DiffRenderer.js', () => ({
  DiffRenderer: function MockDiffRenderer({
    diffContent,
  }: {
    diffContent: string;
  }) {
    return <Text color={Colors.Foreground}>MockDiff:{diffContent}</Text>;
  },
}));
void vi.mock('../../utils/MarkdownDisplay.js', () => ({
  MarkdownDisplay: function MockMarkdownDisplay({ text }: { text: string }) {
    return <Text color={Colors.Foreground}>MockMarkdown:{text}</Text>;
  },
}));
void vi.mock('../ShellInputPrompt.js', () => ({
  ShellInputPrompt: ({ focus }: { focus: boolean }) =>
    focus ? React.createElement(Text, null, 'MockShellInput') : null,
}));

const renderWithContext = (
  ui: React.ReactElement,
  streamingState: StreamingState,
  alwaysDisplayFullShellCommand = true,
) => {
  const contextValue: StreamingState = streamingState;
  const settings = createMockSettings({
    ui: { alwaysDisplayFullShellCommand },
  });
  return renderWithProviders(
    <StreamingContext.Provider value={contextValue}>
      {ui}
    </StreamingContext.Provider>,
    { settings },
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
        <ToolMessage
          {...baseProps}
          name={SHELL_COMMAND_NAME}
          status={ToolCallStatus.Success}
        />,
        StreamingState.Idle,
        false,
      );
      expect(lastFrame()).not.toContain("Press 'ctrl+r'");
    });

    it('shows the hint for a collapsed executing shell command', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name={SHELL_COMMAND_NAME}
          status={ToolCallStatus.Executing}
        />,
        StreamingState.Idle,
        false,
      );

      expect(lastFrame()).toContain("Press 'ctrl+r'");
    });

    it('does not show the hint for an executing non-shell tool', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage {...baseProps} status={ToolCallStatus.Executing} />,
        StreamingState.Idle,
        false,
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

  describe('shell command description display', () => {
    const longDescription =
      'printf first-segment second-segment third-segment final-shell-marker';

    it('displays the complete shell command by default', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name={SHELL_COMMAND_NAME}
          description={longDescription}
          terminalWidth={32}
        />,
        StreamingState.Idle,
      );

      expect(lastFrame()).toContain('final-shell-marker');
    });

    it('truncates shell commands when full display is disabled', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          name={SHELL_COMMAND_NAME}
          description={longDescription}
          terminalWidth={32}
        />,
        StreamingState.Idle,
        false,
      );

      expect(lastFrame()).not.toContain('final-shell-marker');
    });

    it('keeps non-shell tool descriptions truncated', () => {
      const { lastFrame } = renderWithContext(
        <ToolMessage
          {...baseProps}
          description={longDescription}
          terminalWidth={32}
        />,
        StreamingState.Idle,
      );

      expect(lastFrame()).not.toContain('final-shell-marker');
    });
  });

  describe('shell focus state for completed shell with live PTY', () => {
    const shellConfig = {
      getEnableInteractiveShell: () => true,
    } as unknown as ShellState;

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
          shell={shellConfig}
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
          shell={shellConfig}
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
          shell={shellConfig}
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
          shell={shellConfig}
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
          shell={shellConfig}
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
          shell={shellConfig}
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
          shell={shellConfig}
        />,
        StreamingState.Idle,
      );
      expect(lastFrame()).toContain('MockShellInput');
    });
  });

  // @plan PLAN-20260824-ISSUE2021.P05 @requirement REQ-2021.5: status transitions on rerender of the same instance
  describe('status transitions on rerender', () => {
    it('updates the status glyph when the same call rerenders through terminal states', () => {
      // @plan PLAN-20260824-ISSUE2021.P05 @requirement REQ-2021.5
      const transitionProps: ToolMessageProps = {
        ...baseProps,
        name: 'read_file',
        description: 'Read a file',
        status: ToolCallStatus.Confirming,
        resultDisplay: 'output',
        emphasis: 'high',
      };

      const settings = createMockSettings({
        ui: { alwaysDisplayFullShellCommand: true },
      });
      const uiState: Partial<UIState> = { renderMarkdown: true };
      // The provider stack must be identical across initial render and every
      // rerender so React reconciles in place instead of remounting the tree.
      const wrapWithStatus = (status: ToolCallStatus) => (
        <SettingsContext.Provider value={settings}>
          <UIStateContext.Provider value={uiState as UIState}>
            <KeypressProvider>
              <MouseProvider mouseEventsEnabled={false}>
                <ShellCommandDisplayProvider
                  alwaysDisplayFullShellCommand={true}
                >
                  <StreamingContext.Provider value={StreamingState.Idle}>
                    <ToolMessage {...transitionProps} status={status} />
                  </StreamingContext.Provider>
                </ShellCommandDisplayProvider>
              </MouseProvider>
            </KeypressProvider>
          </UIStateContext.Provider>
        </SettingsContext.Provider>
      );

      const { lastFrame, rerender } = actRender(
        wrapWithStatus(ToolCallStatus.Confirming),
      );
      expect(lastFrame()).toContain(TOOL_STATUS.CONFIRMING);
      expect(lastFrame()).not.toContain(TOOL_STATUS.SUCCESS);

      rerender(wrapWithStatus(ToolCallStatus.Success));
      expect(lastFrame()).toContain(TOOL_STATUS.SUCCESS);
      expect(lastFrame()).not.toContain(TOOL_STATUS.CONFIRMING);

      rerender(wrapWithStatus(ToolCallStatus.Error));
      expect(lastFrame()).toContain(TOOL_STATUS.ERROR);
      expect(lastFrame()).not.toContain(TOOL_STATUS.SUCCESS);

      rerender(wrapWithStatus(ToolCallStatus.Canceled));
      expect(lastFrame()).toContain(TOOL_STATUS.CANCELED);
      expect(lastFrame()).not.toContain(TOOL_STATUS.ERROR);
    });

    it('renders different indicators for error vs canceled calls', () => {
      // @plan PLAN-20260824-ISSUE2021.P05 @requirement REQ-2021.5
      const renderWithStatus = (status: ToolCallStatus) =>
        renderWithContext(
          <ToolMessage
            {...baseProps}
            name="web_fetch"
            status={status}
            resultDisplay="payload"
          />,
          StreamingState.Idle,
        ).lastFrame();

      const errorFrame = renderWithStatus(ToolCallStatus.Error);
      const canceledFrame = renderWithStatus(ToolCallStatus.Canceled);

      expect(errorFrame).toContain(TOOL_STATUS.ERROR);
      expect(canceledFrame).toContain(TOOL_STATUS.CANCELED);
      expect(canceledFrame).not.toContain(TOOL_STATUS.ERROR);
      expect(errorFrame).not.toContain(TOOL_STATUS.CANCELED);
    });
  });
});
