/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { Tool, Config } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

interface UseToolsDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  appState: AppState;
  config: Config;
}

export const useToolsDialog = ({
  addMessage,
  appState,
  config,
}: UseToolsDialogParams) => {
  const appDispatch = useAppDispatch();
  const showDialog = appState.openDialogs.tools;
  const [action, setAction] = useState<'enable' | 'disable'>('disable');
  const [availableTools, setAvailableTools] = useState<Tool[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);

  const openDialog = useCallback(
    async (dialogAction: 'enable' | 'disable') => {
      try {
        const toolRegistry = await config.getToolRegistry();
        if (!toolRegistry) {
          addMessage({
            type: MessageType.ERROR,
            content: 'Could not retrieve tool registry.',
            timestamp: new Date(),
          });
          return;
        }

        // Get current disabled tools from ephemeral settings
        const ephemeralSettings = config.getEphemeralSettings() || {};
        const currentDisabledTools =
          (ephemeralSettings['disabled-tools'] as string[]) || [];

        // Get all non-MCP tools
        const allTools = toolRegistry.getAllTools();
        const geminiTools = allTools.filter(
          (tool: Tool) => !('serverName' in tool),
        );

        // Filter tools based on the action
        let tools: Tool[];
        if (dialogAction === 'disable') {
          // Show only enabled tools for disabling
          tools = geminiTools.filter(
            (tool: Tool) => !currentDisabledTools.includes(tool.name),
          );
        } else {
          // Show only disabled tools for enabling
          tools = geminiTools.filter((tool: Tool) =>
            currentDisabledTools.includes(tool.name),
          );
        }

        if (tools.length === 0) {
          addMessage({
            type: MessageType.INFO,
            content:
              dialogAction === 'disable'
                ? 'All tools are already disabled.'
                : 'No tools are currently disabled.',
            timestamp: new Date(),
          });
          return;
        }

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

      // Update disabled tools list
      let updatedDisabledTools: string[];
      if (action === 'disable') {
        updatedDisabledTools = [...disabledTools, toolName];
      } else {
        updatedDisabledTools = disabledTools.filter(
          (name) => name !== toolName,
        );
      }

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
