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

function hasNoContextSummary(counts: {
  effectiveMdFileCount: number;
  effectiveCoreCount: number;
  mcpServerCount: number;
  blockedMcpServerCount: number;
  openFileCount: number;
  skillCount: number | undefined;
}): boolean {
  const nonSkillCounts = [
    counts.effectiveMdFileCount,
    counts.effectiveCoreCount,
    counts.mcpServerCount,
    counts.blockedMcpServerCount,
    counts.openFileCount,
  ];
  return (
    nonSkillCounts.every((count) => count === 0) && counts.skillCount === 0
  );
}

function buildOpenFilesText(openFileCount: number): string {
  if (openFileCount === 0) {
    return '';
  }
  const suffix = openFileCount > 1 ? 's' : '';
  return `${openFileCount} open file${suffix} (ctrl+g to view)`;
}

function buildCoreMemoryText(effectiveCoreCount: number): string {
  if (effectiveCoreCount === 0) {
    return '';
  }
  const suffix = effectiveCoreCount > 1 ? 's' : '';
  return `${effectiveCoreCount} .LLXPRT_SYSTEM file${suffix}`;
}

function buildGeminiMdText(
  effectiveMdFileCount: number,
  contextFileNames: string[],
): string {
  if (effectiveMdFileCount === 0) {
    return '';
  }
  const allNamesTheSame = new Set(contextFileNames).size < 2;
  const name = allNamesTheSame ? contextFileNames[0] : 'context';
  return `${effectiveMdFileCount} ${name} file${
    effectiveMdFileCount > 1 ? 's' : ''
  }`;
}

function buildMcpText(
  mcpServerCount: number,
  blockedMcpServerCount: number,
): string {
  if (mcpServerCount === 0 && blockedMcpServerCount === 0) {
    return '';
  }

  const parts = [];
  if (mcpServerCount > 0) {
    parts.push(`${mcpServerCount} MCP server${mcpServerCount > 1 ? 's' : ''}`);
  }

  if (blockedMcpServerCount > 0) {
    let blockedText = `${blockedMcpServerCount} Blocked`;
    if (mcpServerCount === 0) {
      blockedText += ` MCP server${blockedMcpServerCount > 1 ? 's' : ''}`;
    }
    parts.push(blockedText);
  }
  return parts.join(', ');
}

function buildSkillText(skillCount: number | undefined): string {
  if (skillCount === 0) {
    return '';
  }
  return `${skillCount ?? 0} skill${(skillCount ?? 0) > 1 ? 's' : ''}`;
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
  const mcpServerCount = Object.keys(mcpServers ?? {}).length;
  const blockedMcpServerCount = blockedMcpServers?.length ?? 0;
  const openFileCount = ideContext?.workspaceState?.openFiles?.length ?? 0;

  if (
    hasNoContextSummary({
      effectiveMdFileCount,
      effectiveCoreCount,
      mcpServerCount,
      blockedMcpServerCount,
      openFileCount,
      skillCount,
    })
  ) {
    return <Text color={theme.text.primary}> </Text>;
  }

  const openFilesText = buildOpenFilesText(openFileCount);
  const coreMemoryText = buildCoreMemoryText(effectiveCoreCount);
  const geminiMdText = buildGeminiMdText(
    effectiveMdFileCount,
    contextFileNames,
  );
  const mcpText = buildMcpText(mcpServerCount, blockedMcpServerCount);
  const skillText = buildSkillText(skillCount);

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
