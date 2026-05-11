/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

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
import { ProfileChangeMessage } from './messages/ProfileChangeMessage.js';
import { Box, Text } from 'ink';
import { AboutBox } from './AboutBox.js';
import { StatsDisplay } from './StatsDisplay.js';
import { ModelStatsDisplay } from './ModelStatsDisplay.js';
import { ToolStatsDisplay } from './ToolStatsDisplay.js';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import { LBStatsDisplay } from './LBStatsDisplay.js';
import { SessionSummaryDisplay } from './SessionSummaryDisplay.js';
import { Help } from './Help.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type { SlashCommand } from '../commands/types.js';
import { ChatList } from './views/ChatList.js';
import { ExtensionsList } from './views/ExtensionsList.js';
import { HooksList } from './views/HooksList.js';
import { SkillsList } from './views/SkillsList.js';

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

function useSanitizedItem(item: HistoryItem) {
  return useMemo(() => {
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
}

function renderCoreMessages(
  itemForDisplay: HistoryItem,
  isPending: boolean,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  _availableTerminalHeightGemini: number | undefined,
) {
  switch (itemForDisplay.type) {
    case 'user':
      return <UserMessage text={itemForDisplay.text} />;
    case 'user_shell':
      return <UserShellMessage text={itemForDisplay.text} />;
    case 'gemini':
      return (
        <GeminiMessage
          text={itemForDisplay.text}
          isPending={isPending}
          availableTerminalHeight={
            _availableTerminalHeightGemini ?? availableTerminalHeight
          }
          terminalWidth={terminalWidth}
          model={itemForDisplay.model}
          profileName={itemForDisplay.profileName}
          thinkingBlocks={itemForDisplay.thinkingBlocks}
        />
      );
    case 'gemini_content':
      return (
        <GeminiMessageContent
          text={itemForDisplay.text}
          isPending={isPending}
          availableTerminalHeight={
            _availableTerminalHeightGemini ?? availableTerminalHeight
          }
          terminalWidth={terminalWidth}
        />
      );
    case 'info':
      return (
        <InfoMessage
          text={itemForDisplay.text}
          icon={itemForDisplay.icon}
          color={itemForDisplay.color}
        />
      );
    case 'warning':
      return <WarningMessage text={itemForDisplay.text} />;
    case 'error':
      return <ErrorMessage text={itemForDisplay.text} />;
    case 'oauth_url':
      return (
        <OAuthUrlMessage text={itemForDisplay.text} url={itemForDisplay.url} />
      );
    default:
      return null;
  }
}

function renderStatsMessages(itemForDisplay: HistoryItem) {
  switch (itemForDisplay.type) {
    case 'stats':
      return (
        <StatsDisplay
          duration={itemForDisplay.duration}
          quotaLines={itemForDisplay.quotaLines}
        />
      );
    case 'model_stats':
      return <ModelStatsDisplay />;
    case 'tool_stats':
      return <ToolStatsDisplay />;
    case 'cache_stats':
      return <CacheStatsDisplay />;
    case 'lb_stats':
      return <LBStatsDisplay />;
    case 'quit':
      return <SessionSummaryDisplay duration={itemForDisplay.duration} />;
    default:
      return null;
  }
}

function renderInfoViews(
  itemForDisplay: HistoryItem,
  slashCommands: readonly SlashCommand[],
) {
  switch (itemForDisplay.type) {
    case 'about':
      return (
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
      );
    case 'help':
      return <Help commands={slashCommands} />;
    case 'compression':
      return <CompressionMessage compression={itemForDisplay.compression} />;
    case 'profile_change':
      return <ProfileChangeMessage profileName={itemForDisplay.profileName} />;
    default:
      return null;
  }
}

function renderListViewMessages(itemForDisplay: HistoryItem) {
  switch (itemForDisplay.type) {
    case 'extensions_list':
      return <ExtensionsList extensions={itemForDisplay.extensions} />;
    case 'hooks_list':
      return <HooksList hooks={itemForDisplay.hooks} />;
    case 'tools_list':
      return (
        <Box>
          <Text color="yellow">Tools list view not yet implemented</Text>
        </Box>
      );
    case 'skills_list':
      return (
        <SkillsList
          skills={itemForDisplay.skills}
          showDescriptions={itemForDisplay.showDescriptions ?? false}
        />
      );
    case 'mcp_status':
      return (
        <Box>
          <Text color="yellow">MCP status view not yet implemented</Text>
        </Box>
      );
    case 'chat_list':
      return <ChatList chats={itemForDisplay.chats} />;
    default:
      return null;
  }
}

function renderToolGroupMessage(
  itemForDisplay: HistoryItem,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  config: Config,
  isFocused: boolean,
  showTodoPanel: boolean,
  _activeShellPtyId: number | null | undefined,
  _embeddedShellFocused: boolean | undefined,
) {
  if (itemForDisplay.type !== 'tool_group') return null;
  return (
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
  );
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
  const itemForDisplay = useSanitizedItem(item);

  return (
    <Box flexDirection="column" key={itemForDisplay.id}>
      {renderCoreMessages(
        itemForDisplay,
        isPending,
        availableTerminalHeight,
        terminalWidth,
        _availableTerminalHeightGemini,
      )}
      {renderStatsMessages(itemForDisplay)}
      {renderInfoViews(itemForDisplay, slashCommands)}
      {renderListViewMessages(itemForDisplay)}
      {renderToolGroupMessage(
        itemForDisplay,
        availableTerminalHeight,
        terminalWidth,
        config,
        isFocused,
        showTodoPanel,
        _activeShellPtyId,
        _embeddedShellFocused,
      )}
    </Box>
  );
};
