/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { IndividualToolCallDisplay } from '../../types.js';
import { ToolCallStatus } from '../../types.js';
import type { TextEmphasis } from './ToolShared.js';
import { ToolMessage } from './ToolMessage.js';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import { Colors } from '../../colors.js';
import { theme } from '../../semantic-colors.js';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  DEFAULT_AGENT_ID,
  formatTodoListForDisplay,
} from '@vybestack/llxprt-code-core';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../../constants.js';
import { useTodoContext } from '../../contexts/TodoContext.js';
import { useToolCallContext } from '../../contexts/ToolCallContext.js';

interface ToolGroupMessageProps {
  groupId: number;
  toolCalls: IndividualToolCallDisplay[];
  agentId?: string;
  availableTerminalHeight?: number;
  terminalWidth: number;
  config: Config;
  isFocused?: boolean;
  showTodoPanel?: boolean;
  activeShellPtyId?: number | null;
  embeddedShellFocused?: boolean;
}

const extractCountFromText = (text?: string): number | undefined => {
  if (!text) {
    return undefined;
  }
  // Static regex for extracting counts from text - no dynamic parts
  // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
  const match = text.match(/(\d+)\s+(tasks?|items?)/i);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
};

const normalizeToolName = (name: string): string =>
  name.replace(/[^a-z]/gi, '').toLowerCase();

const isTodoReadTool = (name: string): boolean =>
  normalizeToolName(name) === 'todoread';

const isTodoWriteTool = (name: string): boolean =>
  normalizeToolName(name) === 'todowrite';

const formatTaskCountLabel = (count: number): string => {
  const normalized = Math.max(count, 0);
  return `${normalized} ${normalized === 1 ? 'task' : 'tasks'}`;
};

const formatTodoWriteSummary = (count: number): string =>
  `✦ Todo list updated (${formatTaskCountLabel(count)}).`;

const formatTodoReadSummary = (count: number): string =>
  `Todo list read (${formatTaskCountLabel(count)}).`;

const deriveTodoCount = (
  tool: IndividualToolCallDisplay,
  fallbackCount: number,
): number => {
  const fromResult =
    typeof tool.resultDisplay === 'string'
      ? extractCountFromText(tool.resultDisplay)
      : undefined;
  if (fromResult !== undefined) {
    return fromResult;
  }
  const fromDescription = extractCountFromText(tool.description);
  if (fromDescription !== undefined) {
    return fromDescription;
  }
  return Math.max(fallbackCount, 0);
};

function transformTodoToolCall(
  tool: IndividualToolCallDisplay,
  isTodoPanelEnabled: boolean,
  todosLength: number,
  textualTodoOutput: string,
): IndividualToolCallDisplay | null {
  if (isTodoPanelEnabled) {
    const count = deriveTodoCount(tool, todosLength);
    if (isTodoReadTool(tool.name)) {
      return {
        ...tool,
        resultDisplay: formatTodoReadSummary(count),
        renderOutputAsMarkdown: false,
      };
    }
    if (isTodoWriteTool(tool.name)) {
      return {
        ...tool,
        resultDisplay: formatTodoWriteSummary(count),
        renderOutputAsMarkdown: false,
      };
    }
    return tool;
  }

  if (isTodoWriteTool(tool.name)) {
    return {
      ...tool,
      resultDisplay: textualTodoOutput,
      renderOutputAsMarkdown: true,
    };
  }

  return tool;
}

function computeAvailableHeightPerTool(
  availableTerminalHeight: number | undefined,
  staticHeight: number,
  filteredToolCalls: IndividualToolCallDisplay[],
): number | undefined {
  let countToolCallsWithResults = 0;
  for (const tool of filteredToolCalls) {
    if (tool.resultDisplay !== undefined && tool.resultDisplay !== '') {
      countToolCallsWithResults++;
    }
  }
  const countOneLineToolCalls =
    filteredToolCalls.length - countToolCallsWithResults;
  const hasAvailableTerminalHeight =
    availableTerminalHeight != null &&
    availableTerminalHeight !== 0 &&
    !Number.isNaN(availableTerminalHeight);

  if (!hasAvailableTerminalHeight) {
    return undefined;
  }

  return Math.max(
    Math.floor(
      (availableTerminalHeight - staticHeight - countOneLineToolCalls) /
        Math.max(1, countToolCallsWithResults),
    ),
    1,
  );
}

function deriveBorderColors(filteredToolCalls: IndividualToolCallDisplay[]): {
  borderColor: string;
  borderDimColor: boolean;
  isShellCommand: boolean;
} {
  const hasPending = !filteredToolCalls.every(
    (t) => t.status === ToolCallStatus.Success,
  );
  const isShellCommand = filteredToolCalls.some(
    (t) => t.name === SHELL_COMMAND_NAME || t.name === SHELL_NAME,
  );
  const borderColor = isShellCommand
    ? theme.ui.symbol
    : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      hasPending
      ? theme.status.warning
      : theme.border.default;
  const borderDimColor = hasPending && !isShellCommand;

  return { borderColor, borderDimColor, isShellCommand };
}

function renderToolCallItem(
  tool: IndividualToolCallDisplay,
  index: number,
  toolAwaitingApproval: IndividualToolCallDisplay | undefined,
  availableTerminalHeightPerToolMessage: number | undefined,
  innerWidth: number,
  isFocused: boolean,
  activeShellPtyId: number | null | undefined,
  embeddedShellFocused: boolean | undefined,
  config: Config,
  borderColor: string,
  borderDimColor: boolean,
): React.ReactNode {
  const isConfirming = toolAwaitingApproval?.callId === tool.callId;
  const isFirst = index === 0;
  let emphasis: TextEmphasis = 'medium';
  if (isConfirming) {
    emphasis = 'high';
  } else if (toolAwaitingApproval !== undefined) {
    emphasis = 'low';
  }

  const showMessageConfirmation =
    tool.status === ToolCallStatus.Confirming &&
    isConfirming &&
    tool.confirmationDetails !== undefined;

  return (
    <Box key={tool.callId} flexDirection="column" minHeight={1}>
      <ToolMessage
        callId={tool.callId}
        name={tool.name}
        description={tool.description}
        resultDisplay={tool.resultDisplay}
        status={tool.status}
        confirmationDetails={tool.confirmationDetails}
        availableTerminalHeight={availableTerminalHeightPerToolMessage}
        terminalWidth={innerWidth}
        emphasis={emphasis}
        renderOutputAsMarkdown={tool.renderOutputAsMarkdown}
        activeShellPtyId={activeShellPtyId}
        embeddedShellFocused={embeddedShellFocused}
        ptyId={tool.ptyId}
        config={config}
        isFirst={isFirst}
        borderColor={borderColor}
        borderDimColor={borderDimColor}
      />
      {showMessageConfirmation && tool.confirmationDetails && (
        <ToolConfirmationMessage
          confirmationDetails={tool.confirmationDetails}
          config={config}
          isFocused={isFocused}
          availableTerminalHeight={availableTerminalHeightPerToolMessage}
          terminalWidth={innerWidth}
        />
      )}
    </Box>
  );
}

function useToolGroupState(
  toolCalls: IndividualToolCallDisplay[],
  isTodoPanelEnabled: boolean,
  todosLength: number,
  textualTodoOutput: string,
): {
  toolAwaitingApproval: IndividualToolCallDisplay | undefined;
  filteredToolCalls: IndividualToolCallDisplay[];
} {
  const toolAwaitingApproval = useMemo(
    () => toolCalls.find((tc) => tc.status === ToolCallStatus.Confirming),
    [toolCalls],
  );

  const filteredToolCalls = useMemo(
    () =>
      toolCalls
        .map((tool) =>
          transformTodoToolCall(
            tool,
            isTodoPanelEnabled,
            todosLength,
            textualTodoOutput,
          ),
        )
        .filter((t): t is IndividualToolCallDisplay => t !== null),
    [toolCalls, isTodoPanelEnabled, textualTodoOutput, todosLength],
  );

  return { toolAwaitingApproval, filteredToolCalls };
}

// Main component renders the border and maps the tools using ToolMessage
export const ToolGroupMessage: React.FC<ToolGroupMessageProps> = ({
  toolCalls,
  agentId,
  availableTerminalHeight,
  terminalWidth,
  config,
  isFocused = true,
  showTodoPanel = true,
  activeShellPtyId,
  embeddedShellFocused,
}) => {
  const { todos } = useTodoContext();
  const { getExecutingToolCalls } = useToolCallContext();
  const isTodoPanelEnabled = showTodoPanel;

  const textualTodoOutput = useMemo(
    () =>
      formatTodoListForDisplay(todos, {
        getLiveToolCalls: (todoId: string) => getExecutingToolCalls(todoId),
      }),
    [todos, getExecutingToolCalls],
  );

  const { toolAwaitingApproval, filteredToolCalls } = useToolGroupState(
    toolCalls,
    isTodoPanelEnabled,
    todos.length,
    textualTodoOutput,
  );

  if (filteredToolCalls.length === 0) {
    return null;
  }

  const { borderColor, borderDimColor } = deriveBorderColors(filteredToolCalls);
  const staticHeight = 2 + 1;
  const innerWidth = terminalWidth;

  const availableTerminalHeightPerToolMessage = computeAvailableHeightPerTool(
    availableTerminalHeight,
    staticHeight,
    filteredToolCalls,
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      width="100%"
      marginLeft={1}
      borderDimColor={borderDimColor}
      borderColor={borderColor}
      gap={1}
    >
      {agentId && agentId !== DEFAULT_AGENT_ID && (
        <Box marginLeft={1}>
          <Text color={Colors.AccentCyan}>{`Agent: ${agentId}`}</Text>
        </Box>
      )}
      {filteredToolCalls.map((tool, index) =>
        renderToolCallItem(
          tool,
          index,
          toolAwaitingApproval,
          availableTerminalHeightPerToolMessage,
          innerWidth,
          isFocused,
          activeShellPtyId,
          embeddedShellFocused,
          config,
          borderColor,
          borderDimColor,
        ),
      )}
    </Box>
  );
};
