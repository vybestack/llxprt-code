/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { themeManager } from '../themes/theme-manager.js';
import { shortenPath, tildeifyPath, tokenLimit } from '@google/gemini-cli-core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
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
}) => {
  const theme = themeManager.getActiveTheme();
  const limit = tokenLimit(model);
  const percentage = totalTokenCount / limit;

  return (
    <Box marginTop={1} justifyContent="space-between" width="100%">
      <Box>
        <Text color={theme.colors.LightBlue}>
          {shortenPath(tildeifyPath(targetDir), 70)}
          {branchName && <Text color={theme.colors.Gray}> ({branchName}*)</Text>}
        </Text>
        {debugMode && (
          <Text color={theme.colors.AccentRed}>
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
          <Text color={theme.colors.AccentGreen}>
            {process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}
          </Text>
        ) : process.env.SANDBOX === 'sandbox-exec' ? (
          <Text color={theme.colors.AccentYellow}>
            MacOS Seatbelt{' '}
            <Text color={theme.colors.Gray}>({process.env.SEATBELT_PROFILE})</Text>
          </Text>
        ) : (
          <Text color={theme.colors.AccentRed}>
            no sandbox <Text color={theme.colors.Gray}>(see /docs)</Text>
          </Text>
        )}
      </Box>

      {/* Right Section: Gemini Label and Console Summary */}
      <Box alignItems="center">
        <Text color={theme.colors.AccentBlue}>
          {' '}
          {model}{' '}
          <Text color={theme.colors.Gray}>
            ({((1 - percentage) * 100).toFixed(0)}% context left)
          </Text>
        </Text>
        {corgiMode && (
          <Text>
            <Text color={theme.colors.Gray}>| </Text>
            <Text color={theme.colors.AccentRed}>▼</Text>
            <Text color={theme.colors.Foreground}>(´</Text>
            <Text color={theme.colors.AccentRed}>ᴥ</Text>
            <Text color={theme.colors.Foreground}>`)</Text>
            <Text color={theme.colors.AccentRed}>▼ </Text>
          </Text>
        )}
        {!showErrorDetails && errorCount > 0 && (
          <Box>
            <Text color={theme.colors.Gray}>| </Text>
            <ConsoleSummaryDisplay errorCount={errorCount} />
          </Box>
        )}
        {showMemoryUsage && <MemoryUsageDisplay />}
      </Box>
    </Box>
  );
};
