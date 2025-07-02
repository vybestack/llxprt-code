/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { shortenPath, tildeifyPath, tokenLimit } from '@google/gemini-cli-core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { OpenAIProvider } from '../../providers/openai/OpenAIProvider.js';
import process from 'node:process';
import { MemoryUsageDisplay } from './MemoryUsageDisplay.js';

interface FooterProps {
  model: string;
  targetDir: string;
  branchName?: string;
  debugMode: boolean;
  debugMessage: string;
  corgiMode: boolean;
  errorCount: number;
  showErrorDetails: boolean;
  showMemoryUsage?: boolean;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  conversationId?: string;
  parentId?: string;
}

export const Footer: React.FC<FooterProps> = ({
  model,
  targetDir,
  branchName,
  debugMode,
  debugMessage,
  corgiMode,
  errorCount,
  showErrorDetails,
  showMemoryUsage,
  totalTokenCount,
  conversationId,
  parentId,
}) => {
  // Check if we're using OpenAI provider with remote context
  let limit = tokenLimit(model);
  let percentage = limit > 0 ? totalTokenCount / limit : 0;
  let remoteTokens = 0;

  try {
    const providerManager = getProviderManager();
    if (providerManager.hasActiveProvider()) {
      const provider = providerManager.getActiveProvider();

      // Check if it's OpenAI provider and we have conversation context
      if (provider instanceof OpenAIProvider && conversationId && parentId) {
        // Get remote context estimation
        const contextInfo = provider.estimateContextUsage(
          conversationId,
          parentId,
          [], // Empty array since we're just checking accumulated tokens
        );

        // Use the remote-aware context calculation
        limit = contextInfo.maxTokens;
        percentage = contextInfo.contextUsedPercent / 100;
        remoteTokens = contextInfo.remoteTokens;
      }
    }
  } catch (error) {
    // Fallback to local calculation if there's any error
    console.debug('Error getting remote context:', error);
  }

  return (
    <Box marginTop={1} justifyContent="space-between" width="100%">
      <Box>
        <Text color={Colors.LightBlue}>
          {shortenPath(tildeifyPath(targetDir), 70)}
          {branchName && <Text color={Colors.Gray}> ({branchName}*)</Text>}
        </Text>
        {debugMode && (
          <Text color={Colors.AccentRed}>
            {' ' + (debugMessage || '--debug')}
          </Text>
        )}
      </Box>

      {/* Middle Section: Centered Sandbox Info */}
      <Box
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
        display="flex"
      >
        {process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec' ? (
          <Text color={Colors.AccentGreen}>
            {process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}
          </Text>
        ) : process.env.SANDBOX === 'sandbox-exec' ? (
          <Text color={Colors.AccentYellow}>
            MacOS Seatbelt{' '}
            <Text color={Colors.Gray}>({process.env.SEATBELT_PROFILE})</Text>
          </Text>
        ) : (
          <Text color={Colors.AccentRed}>
            no sandbox <Text color={Colors.Gray}>(see /docs)</Text>
          </Text>
        )}
      </Box>

      {/* Right Section: Gemini Label and Console Summary */}
      <Box alignItems="center">
        <Text color={Colors.AccentBlue}>
          {' '}
          {model}{' '}
          <Text color={Colors.Gray}>
            ({Math.max(0, Math.round((1 - percentage) * 100))}% context left
            {remoteTokens > 0
              ? ` [${Math.round(remoteTokens / 1000)}k remote]`
              : ''}
            )
          </Text>
        </Text>
        {corgiMode && (
          <Text>
            <Text color={Colors.Gray}>| </Text>
            <Text color={Colors.AccentRed}>▼</Text>
            <Text color={Colors.Foreground}>(´</Text>
            <Text color={Colors.AccentRed}>ᴥ</Text>
            <Text color={Colors.Foreground}>`)</Text>
            <Text color={Colors.AccentRed}>▼ </Text>
          </Text>
        )}
        {!showErrorDetails && errorCount > 0 && (
          <Box>
            <Text color={Colors.Gray}>| </Text>
            <ConsoleSummaryDisplay errorCount={errorCount} />
          </Box>
        )}
        {showMemoryUsage && <MemoryUsageDisplay />}
      </Box>
    </Box>
  );
};
