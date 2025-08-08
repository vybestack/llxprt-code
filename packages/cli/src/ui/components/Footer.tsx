/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors, SemanticColors } from '../colors.js';
import { shortenPath, tildeifyPath } from '@vybestack/llxprt-code-core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
import process from 'node:process';
import Gradient from 'ink-gradient';
import { MemoryUsageDisplay } from './MemoryUsageDisplay.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';
import { DebugProfiler } from './DebugProfiler.js';

interface FooterProps {
  model: string;
  targetDir: string;
  branchName?: string;
  debugMode: boolean;
  debugMessage: string;
  errorCount: number;
  showErrorDetails: boolean;
  showMemoryUsage?: boolean;
  promptTokenCount: number;
  isPaidMode?: boolean;
  nightly: boolean;
  vimMode?: string;
  contextLimit?: number;
}

export const Footer: React.FC<FooterProps> = ({
  model,
  targetDir,
  branchName,
  debugMode,
  debugMessage,
  errorCount,
  showErrorDetails,
  showMemoryUsage,
  promptTokenCount,
  isPaidMode,
  nightly,
  vimMode,
  contextLimit,
}) => (
  <Box justifyContent="space-between" width="100%">
    <Box>
      {debugMode && <DebugProfiler />}
      {vimMode && (
        <Text color={SemanticColors.text.secondary}>[{vimMode}] </Text>
      )}
      {nightly ? (
        <Gradient colors={Colors.GradientColors}>
          <Text>
            {shortenPath(tildeifyPath(targetDir), 70)}
            {branchName && <Text> ({branchName}*)</Text>}
          </Text>
        </Gradient>
      ) : (
        <Text color={Colors.LightBlue}>
          {shortenPath(tildeifyPath(targetDir), 70)}
          {branchName && (
            <Text color={SemanticColors.text.secondary}> ({branchName}*)</Text>
          )}
        </Text>
      )}
      {debugMode && (
        <Text color={SemanticColors.status.error}>
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
        <Text color={SemanticColors.status.success}>
          {process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}
        </Text>
      ) : process.env.SANDBOX === 'sandbox-exec' ? (
        <Text color={SemanticColors.status.warning}>
          macOS Seatbelt{' '}
          <Text color={SemanticColors.text.secondary}>
            ({process.env.SEATBELT_PROFILE})
          </Text>
        </Text>
      ) : (
        <Text color={SemanticColors.status.error}>
          no sandbox{' '}
          <Text color={SemanticColors.text.secondary}>(see /docs)</Text>
        </Text>
      )}
    </Box>

    {/* Right Section: Gemini Label and Console Summary */}
    <Box alignItems="center">
      <Text color={SemanticColors.text.accent}>
        {' '}
        {model}{' '}
        <ContextUsageDisplay
          promptTokenCount={promptTokenCount}
          model={model}
          contextLimit={contextLimit}
        />
      </Text>
      {isPaidMode !== undefined &&
        (() => {
          const providerManager = getProviderManager();
          const activeProvider = providerManager?.getActiveProvider?.();
          const isGeminiProvider = activeProvider?.name === 'gemini';

          // Only show paid/free mode for Gemini provider
          if (isGeminiProvider) {
            return (
              <Text>
                <Text color={SemanticColors.text.secondary}> | </Text>
                <Text
                  color={
                    isPaidMode
                      ? SemanticColors.status.warning
                      : SemanticColors.status.success
                  }
                >
                  {isPaidMode ? 'paid mode' : 'free mode'}
                </Text>
              </Text>
            );
          }
          return null;
        })()}

      {!showErrorDetails && errorCount > 0 && (
        <Box>
          <Text color={SemanticColors.text.secondary}>| </Text>
          <ConsoleSummaryDisplay errorCount={errorCount} />
        </Box>
      )}
      {showMemoryUsage && <MemoryUsageDisplay />}
    </Box>
  </Box>
);
