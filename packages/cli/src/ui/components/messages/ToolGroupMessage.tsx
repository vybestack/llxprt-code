/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { ToolMessage } from './ToolMessage.js';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import { Colors } from '../../colors.js';
import { theme } from '../../semantic-colors.js';
import {
  Config,
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

  // only prompt for tool approval on the first 'confirming' tool in the list
  // note, after the CTA, this automatically moves over to the next 'confirming' tool
  const toolAwaitingApproval = useMemo(
    () => toolCalls.find((tc) => tc.status === ToolCallStatus.Confirming),
    [toolCalls],
  );

  // Filter out todo_read completely when panel is visible
  // and minimize todo_write output
  const filteredToolCalls = useMemo(
    () =>
      toolCalls
        .map((tool) => {
          if (isTodoPanelEnabled) {
            const count = deriveTodoCount(tool, todos.length);

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
        })
        .filter(Boolean) as IndividualToolCallDisplay[],
    [toolCalls, isTodoPanelEnabled, textualTodoOutput, todos.length],
  );

  // If all tools were filtered out, don't render anything
  if (filteredToolCalls.length === 0) {
    return null;
  }

  const hasPending = !filteredToolCalls.every(
    (t) => t.status === ToolCallStatus.Success,
  );
  const isShellCommand = filteredToolCalls.some(
    (t) => t.name === SHELL_COMMAND_NAME || t.name === SHELL_NAME,
  );
  const borderColor = isShellCommand
    ? theme.ui.symbol
    : hasPending
      ? theme.status.warning
      : theme.border.default;
  const borderDimColor = hasPending && !isShellCommand;

  const staticHeight = /* border */ 2 + /* marginBottom */ 1;
  const innerWidth = terminalWidth;

  let countToolCallsWithResults = 0;
  for (const tool of filteredToolCalls) {
    if (tool.resultDisplay !== undefined && tool.resultDisplay !== '') {
      countToolCallsWithResults++;
    }
  }
  const countOneLineToolCalls =
    filteredToolCalls.length - countToolCallsWithResults;
  const availableTerminalHeightPerToolMessage = availableTerminalHeight
    ? Math.max(
        Math.floor(
          (availableTerminalHeight - staticHeight - countOneLineToolCalls) /
            Math.max(1, countToolCallsWithResults),
        ),
        1,
      )
    : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      /*
        This width constraint is highly important and protects us from an Ink rendering bug.
        Since the ToolGroup can typically change rendering states frequently, it can cause
        Ink to render the border of the box incorrectly and span multiple lines and even
        cause tearing.
      */
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
      {filteredToolCalls.map((tool, index) => {
        const isConfirming = toolAwaitingApproval?.callId === tool.callId;
        const isFirst = index === 0;
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
              emphasis={
                isConfirming ? 'high' : toolAwaitingApproval ? 'low' : 'medium'
              }
              renderOutputAsMarkdown={tool.renderOutputAsMarkdown}
              activeShellPtyId={activeShellPtyId}
              embeddedShellFocused={embeddedShellFocused}
              ptyId={tool.ptyId}
              config={config}
              isFirst={isFirst}
              borderColor={borderColor}
              borderDimColor={borderDimColor}
            />
            {tool.status === ToolCallStatus.Confirming &&
              isConfirming &&
              tool.confirmationDetails && (
                <ToolConfirmationMessage
                  confirmationDetails={tool.confirmationDetails}
                  config={config}
                  isFocused={isFocused}
                  availableTerminalHeight={
                    availableTerminalHeightPerToolMessage
                  }
                  terminalWidth={innerWidth}
                />
              )}
          </Box>
        );
      })}
    </Box>
  );
};
