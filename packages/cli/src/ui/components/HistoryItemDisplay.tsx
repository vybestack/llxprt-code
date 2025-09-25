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
import { Box } from 'ink';
import { AboutBox } from './AboutBox.js';
import { StatsDisplay } from './StatsDisplay.js';
import { ModelStatsDisplay } from './ModelStatsDisplay.js';
import { ToolStatsDisplay } from './ToolStatsDisplay.js';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import { SessionSummaryDisplay } from './SessionSummaryDisplay.js';
import { Help } from './Help.js';
import { Config } from '@vybestack/llxprt-code-core';
import { SlashCommand } from '../commands/types.js';

interface HistoryItemDisplayProps {
  item: HistoryItem;
  availableTerminalHeight?: number;
  terminalWidth: number;
  isPending: boolean;
  config: Config;
  isFocused?: boolean;
  slashCommands?: readonly SlashCommand[]; // For help display
  showTodoPanel?: boolean;
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
}) => {
  const itemForDisplay = useMemo(() => escapeAnsiCtrlCodes(item), [item]);

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
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
          model={itemForDisplay.model}
        />
      )}
      {itemForDisplay.type === 'gemini_content' && (
        <GeminiMessageContent
          text={itemForDisplay.text}
          isPending={isPending}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
        />
      )}
      {itemForDisplay.type === 'info' && (
        <InfoMessage text={itemForDisplay.text} />
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
          selectedAuthType={itemForDisplay.selectedAuthType}
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
        />
      )}
      {itemForDisplay.type === 'compression' && (
        <CompressionMessage compression={itemForDisplay.compression} />
      )}
    </Box>
  );
};
