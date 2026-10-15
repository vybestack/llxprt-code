/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import { MessageType } from '../types.js';

interface UseToolsDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  listTools: (() => readonly ToolInfo[]) | null;
  readDisabledTools: () => unknown;
  writeDisabledTools: (names: string[]) => void;
  openToolsDialog: (action: 'enable' | 'disable') => void;
  closeToolsDialog: () => void;
}

function getDisabledTools(readDisabledTools: () => unknown): string[] {
  const disabledToolsValue = readDisabledTools();
  return Array.isArray(disabledToolsValue) ? disabledToolsValue : [];
}

function filterToolsByAction(
  tools: ToolInfo[],
  disabledTools: string[],
  action: 'enable' | 'disable',
): ToolInfo[] {
  if (action === 'disable') {
    // Show only enabled tools for disabling
    return tools.filter((tool: ToolInfo) => !disabledTools.includes(tool.name));
  }
  // Show only disabled tools for enabling
  return tools.filter((tool: ToolInfo) => disabledTools.includes(tool.name));
}

function buildNoToolsMessage(action: 'enable' | 'disable'): string {
  return action === 'disable'
    ? 'All tools are already disabled.'
    : 'No tools are currently disabled.';
}

async function loadToolsForDialog(
  listTools: (() => readonly ToolInfo[]) | null,
  readDisabledTools: () => unknown,
  action: 'enable' | 'disable',
): Promise<ToolInfo[] | null> {
  if (listTools === null) {
    return null;
  }

  const disabledTools = getDisabledTools(readDisabledTools);
  const allTools = [...listTools()];
  const agentTools = allTools.filter((tool: ToolInfo) => tool.source !== 'mcp');

  return filterToolsByAction(agentTools, disabledTools, action);
}

function handleEmptyToolsList(
  tools: ToolInfo[],
  action: 'enable' | 'disable',
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void,
): boolean {
  if (tools.length === 0) {
    addMessage({
      type: MessageType.INFO,
      content: buildNoToolsMessage(action),
      timestamp: new Date(),
    });
    return true;
  }
  return false;
}

function updateDisabledToolsList(
  action: 'enable' | 'disable',
  disabledTools: string[],
  toolName: string,
): string[] {
  if (action === 'disable') {
    return [...disabledTools, toolName];
  }
  return disabledTools.filter((name) => name !== toolName);
}

export const useToolsDialog = ({
  addMessage,
  listTools,
  readDisabledTools,
  writeDisabledTools,
  openToolsDialog,
  closeToolsDialog,
}: UseToolsDialogParams) => {
  const [action, setAction] = useState<'enable' | 'disable'>('disable');
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);

  const openDialog = useCallback(
    async (dialogAction: 'enable' | 'disable') => {
      try {
        const tools = await loadToolsForDialog(
          listTools,
          readDisabledTools,
          dialogAction,
        );
        if (tools === null) {
          addMessage({
            type: MessageType.ERROR,
            content: 'Could not retrieve tools from the agent.',
            timestamp: new Date(),
          });
          return;
        }

        if (handleEmptyToolsList(tools, dialogAction, addMessage)) {
          return;
        }

        const currentDisabledTools = getDisabledTools(readDisabledTools);
        setAction(dialogAction);
        setAvailableTools(tools);
        setDisabledTools(currentDisabledTools);
        openToolsDialog(dialogAction);
      } catch (e) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to load tools: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, listTools, readDisabledTools, openToolsDialog],
  );

  const handleSelect = useCallback(
    (toolName: string) => {
      const selectedTool = availableTools.find((t) => t.name === toolName);
      if (!selectedTool) return;

      const updatedDisabledTools = updateDisabledToolsList(
        action,
        disabledTools,
        toolName,
      );

      // Update ephemeral settings
      writeDisabledTools(updatedDisabledTools);

      addMessage({
        type: MessageType.INFO,
        content: `Tool '${selectedTool.displayName ?? selectedTool.name}' has been ${action}d.`,
        timestamp: new Date(),
      });

      closeToolsDialog();
    },
    [
      addMessage,
      writeDisabledTools,
      action,
      availableTools,
      disabledTools,
      closeToolsDialog,
    ],
  );

  return {
    openDialog,
    action,
    availableTools,
    disabledTools,
    handleSelect,
  };
};
