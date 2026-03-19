/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  type IdeContext,
  type MCPServerConfig,
} from '@vybestack/llxprt-code-core';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { isNarrowWidth } from '../utils/isNarrowWidth.js';

interface ContextSummaryDisplayProps {
  llxprtMdFileCount?: number;
  geminiMdFileCount?: number;
  coreMemoryFileCount?: number;
  contextFileNames: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  ideContext?: IdeContext;
  skillCount?: number;
  showToolDescriptions?: boolean;
}

export const ContextSummaryDisplay: React.FC<ContextSummaryDisplayProps> = ({
  llxprtMdFileCount,
  geminiMdFileCount,
  coreMemoryFileCount,
  contextFileNames,
  mcpServers,
  blockedMcpServers,
  ideContext,
  skillCount,
}) => {
  const effectiveMdFileCount = llxprtMdFileCount ?? geminiMdFileCount ?? 0;
  const effectiveCoreCount = coreMemoryFileCount ?? 0;
  const { columns: terminalWidth } = useTerminalSize();
  const isNarrow = isNarrowWidth(terminalWidth);
  const mcpServerCount = Object.keys(mcpServers || {}).length;
  const blockedMcpServerCount = blockedMcpServers?.length || 0;
  const openFileCount = ideContext?.workspaceState?.openFiles?.length ?? 0;

  if (
    effectiveMdFileCount === 0 &&
    effectiveCoreCount === 0 &&
    mcpServerCount === 0 &&
    blockedMcpServerCount === 0 &&
    openFileCount === 0 &&
    skillCount === 0
  ) {
    return <Text color={theme.text.primary}> </Text>; // Render an empty space to reserve height
  }

  const openFilesText = (() => {
    if (openFileCount === 0) {
      return '';
    }
    return `${openFileCount} open file${
      openFileCount > 1 ? 's' : ''
    } (ctrl+g to view)`;
  })();

  const coreMemoryText = (() => {
    if (effectiveCoreCount === 0) {
      return '';
    }
    return `${effectiveCoreCount} .LLXPRT_SYSTEM file${
      effectiveCoreCount > 1 ? 's' : ''
    }`;
  })();

  const geminiMdText = (() => {
    if (effectiveMdFileCount === 0) {
      return '';
    }
    const allNamesTheSame = new Set(contextFileNames).size < 2;
    const name = allNamesTheSame ? contextFileNames[0] : 'context';
    return `${effectiveMdFileCount} ${name} file${
      effectiveMdFileCount > 1 ? 's' : ''
    }`;
  })();

  const mcpText = (() => {
    if (mcpServerCount === 0 && blockedMcpServerCount === 0) {
      return '';
    }

    const parts = [];
    if (mcpServerCount > 0) {
      parts.push(
        `${mcpServerCount} MCP server${mcpServerCount > 1 ? 's' : ''}`,
      );
    }

    if (blockedMcpServerCount > 0) {
      let blockedText = `${blockedMcpServerCount} Blocked`;
      if (mcpServerCount === 0) {
        blockedText += ` MCP server${blockedMcpServerCount > 1 ? 's' : ''}`;
      }
      parts.push(blockedText);
    }
    return parts.join(', ');
  })();

  const skillText = (() => {
    if (skillCount === 0) {
      return '';
    }
    return `${skillCount ?? 0} skill${(skillCount ?? 0) > 1 ? 's' : ''}`;
  })();

  const summaryParts = [
    openFilesText,
    coreMemoryText,
    geminiMdText,
    mcpText,
    skillText,
  ].filter(Boolean);

  if (isNarrow) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {summaryParts.map((part, index) => (
          <Text key={index} color={theme.text.secondary}>
            - {part}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box paddingX={1}>
      <Text color={theme.text.secondary}>{summaryParts.join(' | ')}</Text>
    </Box>
  );
};
