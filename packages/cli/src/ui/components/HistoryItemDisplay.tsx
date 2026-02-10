/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { escapeAnsiCtrlCodes } from '../utils/textUtils.js';
import type { HistoryItem } from '../types.js';
import { UserMessage } from './messages/UserMessage.js';
import { UserShellMessage } from './messages/UserShellMessage.js';
import { GeminiMessage } from './messages/GeminiMessage.js';
import { InfoMessage } from './messages/InfoMessage.js';
import { ErrorMessage } from './messages/ErrorMessage.js';
import { OAuthUrlMessage } from './messages/OAuthUrlMessage.js';
import { ToolGroupMessage } from './messages/ToolGroupMessage.js';
import { GeminiMessageContent } from './messages/GeminiMessageContent.js';
import { CompressionMessage } from './messages/CompressionMessage.js';
import { WarningMessage } from './messages/WarningMessage.js';
import { Box, Text } from 'ink';
import { AboutBox } from './AboutBox.js';
import { StatsDisplay } from './StatsDisplay.js';
import { ModelStatsDisplay } from './ModelStatsDisplay.js';
import { ToolStatsDisplay } from './ToolStatsDisplay.js';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import { LBStatsDisplay } from './LBStatsDisplay.js';
import { SessionSummaryDisplay } from './SessionSummaryDisplay.js';
import { Help } from './Help.js';
import { Config } from '@vybestack/llxprt-code-core';
import type { SlashCommand } from '../commands/types.js';
import { ChatList } from './views/ChatList.js';
import { ExtensionsList } from './views/ExtensionsList.js';

interface HistoryItemDisplayProps {
  item: HistoryItem;
  availableTerminalHeight?: number;
  terminalWidth: number;
  isPending: boolean;
  config: Config;
  isFocused?: boolean;
  slashCommands?: readonly SlashCommand[]; // For help display
  showTodoPanel?: boolean;
  commands?: readonly SlashCommand[];
  activeShellPtyId?: number | null;
  embeddedShellFocused?: boolean;
  availableTerminalHeightGemini?: number;
}

export const HistoryItemDisplay: React.FC<HistoryItemDisplayProps> = ({
  item,
  availableTerminalHeight,
  terminalWidth,
  isPending,
  config,
  isFocused = true,
  slashCommands = [],
  showTodoPanel = true,
  activeShellPtyId: _activeShellPtyId,
  embeddedShellFocused: _embeddedShellFocused,
  availableTerminalHeightGemini: _availableTerminalHeightGemini,
}) => {
  const itemForDisplay = useMemo(() => {
    // Skip sanitization for trusted system message types that may contain ANSI codes
    // for coloring (e.g. from mcpCommand)
    if (
      item.type === 'info' ||
      item.type === 'error' ||
      item.type === 'warning' ||
      item.type === 'oauth_url'
    ) {
      return item;
    }
    return escapeAnsiCtrlCodes(item);
  }, [item]);

  return (
    <Box flexDirection="column" key={itemForDisplay.id}>
      {/* Render standard message types */}
      {itemForDisplay.type === 'user' && (
        <UserMessage text={itemForDisplay.text} />
      )}
      {itemForDisplay.type === 'user_shell' && (
        <UserShellMessage text={itemForDisplay.text} />
      )}
      {itemForDisplay.type === 'gemini' && (
        <GeminiMessage
          text={itemForDisplay.text}
          isPending={isPending}
          availableTerminalHeight={
            _availableTerminalHeightGemini ?? availableTerminalHeight
          }
          terminalWidth={terminalWidth}
          model={itemForDisplay.model}
          thinkingBlocks={itemForDisplay.thinkingBlocks} // @plan:PLAN-20251202-THINKING-UI.P06
        />
      )}
      {itemForDisplay.type === 'gemini_content' && (
        <GeminiMessageContent
          text={itemForDisplay.text}
          isPending={isPending}
          availableTerminalHeight={
            _availableTerminalHeightGemini ?? availableTerminalHeight
          }
          terminalWidth={terminalWidth}
        />
      )}
      {itemForDisplay.type === 'info' && (
        <InfoMessage
          text={itemForDisplay.text}
          icon={itemForDisplay.icon}
          color={itemForDisplay.color}
        />
      )}
      {itemForDisplay.type === 'warning' && (
        <WarningMessage text={itemForDisplay.text} />
      )}
      {itemForDisplay.type === 'error' && (
        <ErrorMessage text={itemForDisplay.text} />
      )}
      {itemForDisplay.type === 'oauth_url' && (
        <OAuthUrlMessage text={itemForDisplay.text} url={itemForDisplay.url} />
      )}
      {itemForDisplay.type === 'about' && (
        <AboutBox
          cliVersion={itemForDisplay.cliVersion}
          osVersion={itemForDisplay.osVersion}
          sandboxEnv={itemForDisplay.sandboxEnv}
          modelVersion={itemForDisplay.modelVersion}
          gcpProject={itemForDisplay.gcpProject}
          ideClient={itemForDisplay.ideClient}
          provider={itemForDisplay.provider}
          baseURL={itemForDisplay.baseURL}
          keyfile={itemForDisplay.keyfile}
          key={itemForDisplay.key}
        />
      )}
      {itemForDisplay.type === 'help' && <Help commands={slashCommands} />}
      {itemForDisplay.type === 'stats' && (
        <StatsDisplay duration={itemForDisplay.duration} />
      )}
      {itemForDisplay.type === 'model_stats' && <ModelStatsDisplay />}
      {itemForDisplay.type === 'tool_stats' && <ToolStatsDisplay />}
      {itemForDisplay.type === 'cache_stats' && <CacheStatsDisplay />}
      {itemForDisplay.type === 'lb_stats' && <LBStatsDisplay />}
      {itemForDisplay.type === 'quit' && (
        <SessionSummaryDisplay duration={itemForDisplay.duration} />
      )}
      {itemForDisplay.type === 'tool_group' && (
        <ToolGroupMessage
          toolCalls={itemForDisplay.tools}
          groupId={itemForDisplay.id}
          agentId={itemForDisplay.agentId}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
          config={config}
          isFocused={isFocused}
          showTodoPanel={showTodoPanel}
          activeShellPtyId={_activeShellPtyId}
          embeddedShellFocused={_embeddedShellFocused}
        />
      )}
      {itemForDisplay.type === 'compression' && (
        <CompressionMessage compression={itemForDisplay.compression} />
      )}
      {itemForDisplay.type === 'extensions_list' && (
        <ExtensionsList extensions={itemForDisplay.extensions} />
      )}
      {itemForDisplay.type === 'tools_list' && (
        <Box>
          <Text color="yellow">Tools list view not yet implemented</Text>
        </Box>
      )}
      {itemForDisplay.type === 'mcp_status' && (
        <Box>
          <Text color="yellow">MCP status view not yet implemented</Text>
        </Box>
      )}
      {itemForDisplay.type === 'chat_list' && (
        <ChatList chats={itemForDisplay.chats} />
      )}
    </Box>
  );
};
