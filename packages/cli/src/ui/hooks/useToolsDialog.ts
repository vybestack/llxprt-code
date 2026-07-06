/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import type { Agent, ToolInfo } from '@vybestack/llxprt-code-agents';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import type { AppState } from '../reducers/appReducer.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

interface UseToolsDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  appState: AppState;
  config: CliUiRuntime;
  agent: Agent | null;
}

function getDisabledToolsFromConfig(config: CliUiRuntime): string[] {
  const ephemeralSettings = config.getEphemeralSettings();
  const disabledToolsValue = ephemeralSettings['disabled-tools'];
  return Array.isArray(disabledToolsValue)
    ? (disabledToolsValue as string[])
    : [];
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
  agent: Agent | null,
  config: CliUiRuntime,
  action: 'enable' | 'disable',
): Promise<ToolInfo[] | null> {
  if (agent === null) {
    return null;
  }

  const disabledTools = getDisabledToolsFromConfig(config);
  const allTools = [...agent.tools.list()];
  const geminiTools = allTools.filter(
    (tool: ToolInfo) => tool.source !== 'mcp',
  );

  return filterToolsByAction(geminiTools, disabledTools, action);
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
  appState,
  config,
  agent,
}: UseToolsDialogParams) => {
  const appDispatch = useAppDispatch();
  const showDialog = appState.openDialogs.tools;
  const [action, setAction] = useState<'enable' | 'disable'>('disable');
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);

  const openDialog = useCallback(
    async (dialogAction: 'enable' | 'disable') => {
      try {
        const tools = await loadToolsForDialog(agent, config, dialogAction);
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

        const currentDisabledTools = getDisabledToolsFromConfig(config);
        setAction(dialogAction);
        setAvailableTools(tools);
        setDisabledTools(currentDisabledTools);
        appDispatch({ type: 'OPEN_DIALOG', payload: 'tools' });
      } catch (e) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to load tools: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, appDispatch, config, agent],
  );

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'tools' }),
    [appDispatch],
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
      config.setEphemeralSetting('disabled-tools', updatedDisabledTools);

      addMessage({
        type: MessageType.INFO,
        content: `Tool '${selectedTool.displayName ?? selectedTool.name}' has been ${action}d.`,
        timestamp: new Date(),
      });

      appDispatch({ type: 'CLOSE_DIALOG', payload: 'tools' });
    },
    [addMessage, appDispatch, config, action, availableTools, disabledTools],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    action,
    availableTools,
    disabledTools,
    handleSelect,
  };
};
