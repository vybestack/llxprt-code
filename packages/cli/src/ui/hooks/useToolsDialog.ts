/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import type { AnyDeclarativeTool, Config } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import type { AppState } from '../reducers/appReducer.js';

interface UseToolsDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  appState: AppState;
  config: Config;
}

function getDisabledToolsFromConfig(config: Config): string[] {
  const ephemeralSettings = config.getEphemeralSettings() as
    | Record<string, unknown>
    | undefined;
  const disabledToolsValue = ephemeralSettings?.['disabled-tools'];
  return Array.isArray(disabledToolsValue)
    ? (disabledToolsValue as string[])
    : [];
}

function filterToolsByAction(
  tools: AnyDeclarativeTool[],
  disabledTools: string[],
  action: 'enable' | 'disable',
): AnyDeclarativeTool[] {
  if (action === 'disable') {
    // Show only enabled tools for disabling
    return tools.filter(
      (tool: AnyDeclarativeTool) => !disabledTools.includes(tool.name),
    );
  }
  // Show only disabled tools for enabling
  return tools.filter((tool: AnyDeclarativeTool) =>
    disabledTools.includes(tool.name),
  );
}

function buildNoToolsMessage(action: 'enable' | 'disable'): string {
  return action === 'disable'
    ? 'All tools are already disabled.'
    : 'No tools are currently disabled.';
}

async function loadToolsForDialog(
  config: Config,
  action: 'enable' | 'disable',
): Promise<AnyDeclarativeTool[] | null> {
  const toolRegistry = config.getToolRegistry() as
    | ReturnType<Config['getToolRegistry']>
    | null
    | undefined;
  if (toolRegistry === null || toolRegistry === undefined) {
    return null;
  }

  const disabledTools = getDisabledToolsFromConfig(config);
  const allTools = toolRegistry.getAllTools();
  const geminiTools = allTools.filter(
    (tool: AnyDeclarativeTool) => !('serverName' in tool),
  );

  return filterToolsByAction(geminiTools, disabledTools, action);
}

function handleEmptyToolsList(
  tools: AnyDeclarativeTool[],
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
}: UseToolsDialogParams) => {
  const appDispatch = useAppDispatch();
  const showDialog = appState.openDialogs.tools;
  const [action, setAction] = useState<'enable' | 'disable'>('disable');
  const [availableTools, setAvailableTools] = useState<AnyDeclarativeTool[]>(
    [],
  );
  const [disabledTools, setDisabledTools] = useState<string[]>([]);

  const openDialog = useCallback(
    async (dialogAction: 'enable' | 'disable') => {
      try {
        const tools = await loadToolsForDialog(config, dialogAction);
        if (tools === null) {
          addMessage({
            type: MessageType.ERROR,
            content: 'Could not retrieve tool registry.',
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
    [addMessage, appDispatch, config],
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
        content: `Tool '${selectedTool.displayName}' has been ${action}d.`,
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
