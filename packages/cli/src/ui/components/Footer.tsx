/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Colors, SemanticColors } from '../colors.js';
import {
  shortenPath,
  tildeifyPath,
  tokenLimit,
} from '@vybestack/llxprt-code-core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
import process from 'node:process';
import Gradient from 'ink-gradient';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { DebugProfiler } from './DebugProfiler.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateMiddle } from '../utils/responsive.js';

interface FooterProps {
  model: string;
  targetDir: string;
  branchName?: string;
  debugMode: boolean;
  debugMessage: string;
  errorCount: number;
  showErrorDetails: boolean;
  promptTokenCount: number;
  isPaidMode?: boolean;
  nightly: boolean;
  vimMode?: string;
  contextLimit?: number;
}

// Responsive Memory Usage Display
const ResponsiveMemoryDisplay: React.FC<{
  compact: boolean;
  detailed: boolean;
}> = ({ compact, detailed }) => {
  const [memoryUsage, setMemoryUsage] = useState<string>('');
  const [memoryUsageColor, setMemoryUsageColor] = useState<string>(
    SemanticColors.text.secondary,
  );

  useEffect(() => {
    const updateMemory = () => {
      const usage = process.memoryUsage().rss;
      const totalMemory = 4.8 * 1024 * 1024 * 1024; // 4.8GB total
      const percentage = Math.round((usage / totalMemory) * 100);

      if (detailed) {
        const usageGB = (usage / (1024 * 1024 * 1024)).toFixed(1);
        const totalGB = (totalMemory / (1024 * 1024 * 1024)).toFixed(1);
        setMemoryUsage(`Memory: ${percentage}% (${usageGB}GB/${totalGB}GB)`);
      } else if (compact) {
        setMemoryUsage(`Mem: ${percentage}%`);
      } else {
        setMemoryUsage(`Memory: ${percentage}%`);
      }

      setMemoryUsageColor(
        usage >= 2 * 1024 * 1024 * 1024
          ? SemanticColors.status.error
          : SemanticColors.text.secondary,
      );
    };

    const intervalId = setInterval(updateMemory, 2000);
    updateMemory(); // Initial update
    return () => clearInterval(intervalId);
  }, [compact, detailed]);

  return <Text color={memoryUsageColor}>{memoryUsage}</Text>;
};

// Responsive Context Usage Display
const ResponsiveContextDisplay: React.FC<{
  promptTokenCount: number;
  model: string;
  contextLimit?: number;
  compact: boolean;
  detailed: boolean;
}> = ({ promptTokenCount, model, contextLimit, compact, detailed }) => {
  const limit = tokenLimit(model, contextLimit);
  const percentage = promptTokenCount / limit;
  const remainingPercentage = (1 - percentage) * 100;

  // Use semantic colors based on how much context is left
  let color: string;
  if (remainingPercentage < 10) {
    color = SemanticColors.status.error;
  } else if (remainingPercentage < 25) {
    color = SemanticColors.status.warning;
  } else {
    color = SemanticColors.text.secondary;
  }

  let displayText: string;
  if (detailed) {
    displayText = `Context: ${promptTokenCount.toLocaleString()}/${limit.toLocaleString()} tokens`;
  } else if (compact) {
    displayText = `Ctx: ${(promptTokenCount / 1000).toFixed(1)}k/${(limit / 1000).toFixed(0)}k`;
  } else {
    displayText = `Context: ${(promptTokenCount / 1000).toFixed(1)}k/${(limit / 1000).toFixed(0)}k`;
  }

  return <Text color={color}>{displayText}</Text>;
};

// Responsive Timestamp Display
const ResponsiveTimestamp: React.FC = () => {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toTimeString().slice(0, 8)); // HH:MM:SS
    };

    const intervalId = setInterval(updateTime, 1000);
    updateTime(); // Initial update
    return () => clearInterval(intervalId);
  }, []);

  return <Text color={SemanticColors.text.secondary}>{time}</Text>;
};

export const Footer: React.FC<FooterProps> = ({
  model,
  targetDir,
  branchName,
  debugMode,
  debugMessage,
  errorCount,
  showErrorDetails,
  promptTokenCount,
  isPaidMode,
  nightly,
  vimMode,
  contextLimit,
}) => {
  const { breakpoint } = useResponsive();

  // Define what to show at each breakpoint
  const showTimestamp = breakpoint === 'WIDE';
  const showModelName = breakpoint !== 'NARROW';
  const isCompact = breakpoint === 'NARROW';
  const isDetailed = breakpoint === 'WIDE';

  // Calculate max length for branch truncation based on breakpoint
  let maxBranchLength: number;
  if (isCompact) {
    maxBranchLength = 15;
  } else if (breakpoint === 'STANDARD') {
    maxBranchLength = 35;
  } else {
    maxBranchLength = 100; // Don't truncate at wide width
  }

  return (
    <Box justifyContent="space-between" width="100%">
      <Box>
        {debugMode && <DebugProfiler />}
        {vimMode && (
          <Text color={SemanticColors.text.secondary}>[{vimMode}] </Text>
        )}

        {/* Path Display */}
        {nightly ? (
          <Gradient colors={Colors.GradientColors}>
            <Text>
              {shortenPath(tildeifyPath(targetDir), isCompact ? 30 : 70)}
              {branchName && (
                <Text>
                  {' '}
                  (
                  {branchName.length > maxBranchLength
                    ? truncateMiddle(branchName, maxBranchLength)
                    : branchName}
                  *)
                </Text>
              )}
            </Text>
          </Gradient>
        ) : (
          <Text color={SemanticColors.text.accent}>
            {shortenPath(tildeifyPath(targetDir), isCompact ? 30 : 70)}
            {branchName && (
              <Text color={SemanticColors.text.secondary}>
                {' '}
                (
                {branchName.length > maxBranchLength
                  ? truncateMiddle(branchName, maxBranchLength)
                  : branchName}
                *)
              </Text>
            )}
          </Text>
        )}
        {debugMode && (
          <Text color={SemanticColors.status.error}>
            {' ' + (debugMessage || '--debug')}
          </Text>
        )}
      </Box>

      {/* Middle Section: Sandbox Info (only show at standard+ widths) */}
      {!isCompact && (
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
      )}

      {/* Right Section: Status Information */}
      <Box alignItems="center" flexWrap="wrap">
        {/* Always show memory and context */}
        <ResponsiveMemoryDisplay compact={isCompact} detailed={isDetailed} />
        <Text color={SemanticColors.text.secondary}> | </Text>

        <ResponsiveContextDisplay
          promptTokenCount={promptTokenCount}
          model={model}
          contextLimit={contextLimit}
          compact={isCompact}
          detailed={isDetailed}
        />

        {/* Conditionally show model name */}
        {showModelName && (
          <>
            <Text color={SemanticColors.text.secondary}> | </Text>
            <Text color={SemanticColors.text.accent}>Model: {model}</Text>
          </>
        )}

        {/* Show paid/free mode for Gemini provider */}
        {isPaidMode !== undefined &&
          (() => {
            const providerManager = getProviderManager();
            const activeProvider = providerManager?.getActiveProvider?.();
            const isGeminiProvider = activeProvider?.name === 'gemini';

            if (isGeminiProvider) {
              return (
                <>
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
                </>
              );
            }
            return null;
          })()}

        {/* Show error count */}
        {!showErrorDetails && errorCount > 0 && (
          <>
            <Text color={SemanticColors.text.secondary}> | </Text>
            <ConsoleSummaryDisplay errorCount={errorCount} />
          </>
        )}

        {/* Show timestamp only at wide width */}
        {showTimestamp && (
          <>
            <Text color={SemanticColors.text.secondary}> | </Text>
            <ResponsiveTimestamp />
          </>
        )}
      </Box>
    </Box>
  );
};
