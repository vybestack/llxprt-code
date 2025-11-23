/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.1
 */

/* eslint-disable react/prop-types */
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
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugProfiler } from './DebugProfiler.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateMiddle } from '../utils/responsive.js';

export interface FooterProps {
  model: string;
  targetDir: string;
  branchName?: string;
  debugMode: boolean;
  debugMessage: string;
  errorCount: number;
  showErrorDetails: boolean;
  showMemoryUsage?: boolean;
  historyTokenCount: number;
  isPaidMode?: boolean;
  nightly: boolean;
  vimMode?: string;
  contextLimit?: number;
  isTrustedFolder?: boolean;
  // Token tracking metrics
  tokensPerMinute?: number;
  throttleWaitTimeMs?: number;
  sessionTokenTotal?: number;
  // Footer visibility settings
  hideCWD?: boolean;
  hideSandboxStatus?: boolean;
  hideModelInfo?: boolean;
}

// Responsive Memory Usage Display - Memoized to prevent re-renders
const ResponsiveMemoryDisplay = React.memo<{
  compact: boolean;
  detailed: boolean;
}>(({ compact, detailed }) => {
  // Initialize with immediate value to avoid empty render in tests
  const initialUsage = process.memoryUsage().rss;
  const initialPercentage = Math.round(
    (initialUsage / (4.8 * 1024 * 1024 * 1024)) * 100,
  );

  let initialText: string;
  if (detailed) {
    const usageGB = (initialUsage / (1024 * 1024 * 1024)).toFixed(1);
    initialText = `Memory: ${initialPercentage}% (${usageGB}GB/4.8GB)`;
  } else if (compact) {
    initialText = `Mem: ${initialPercentage}%`;
  } else {
    initialText = `Memory: ${initialPercentage}%`;
  }

  const [memoryUsage, setMemoryUsage] = useState<string>(initialText);
  const [memoryUsageColor, setMemoryUsageColor] = useState<string>(
    initialUsage >= 2 * 1024 * 1024 * 1024
      ? SemanticColors.status.error
      : SemanticColors.text.secondary,
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
    // Don't call updateMemory immediately since we have initial value
    return () => clearInterval(intervalId);
  }, [compact, detailed]);

  return <Text color={memoryUsageColor}>{memoryUsage}</Text>;
});
ResponsiveMemoryDisplay.displayName = 'ResponsiveMemoryDisplay';

// Responsive Context Usage Display - Memoized to prevent re-renders
const ResponsiveContextDisplay = React.memo<{
  historyTokenCount: number;
  model: string;
  contextLimit?: number;
  compact: boolean;
  detailed: boolean;
}>(({ historyTokenCount, model, contextLimit, compact, detailed }) => {
  const limit = tokenLimit(model, contextLimit);
  const percentage = historyTokenCount / limit;
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
    displayText = `Context: ${historyTokenCount.toLocaleString()}/${limit.toLocaleString()} tokens`;
  } else if (compact) {
    displayText = `Ctx: ${(historyTokenCount / 1000).toFixed(1)}k/${(limit / 1000).toFixed(0)}k`;
  } else {
    displayText = `Context: ${(historyTokenCount / 1000).toFixed(1)}k/${(limit / 1000).toFixed(0)}k`;
  }

  return <Text color={color}>{displayText}</Text>;
});
ResponsiveContextDisplay.displayName = 'ResponsiveContextDisplay';

// Debounced TPM Display - Updates less frequently to reduce flicker
const DebouncedTPMDisplay = React.memo<{ tokensPerMinute?: number }>(
  ({ tokensPerMinute }) => {
    const [displayTPM, setDisplayTPM] = useState<number | undefined>(
      tokensPerMinute,
    );

    useEffect(() => {
      // Debounce TPM updates to reduce flicker
      const timeoutId = setTimeout(() => {
        setDisplayTPM(tokensPerMinute);
      }, 500); // 500ms debounce

      return () => clearTimeout(timeoutId);
    }, [tokensPerMinute]);

    if (displayTPM === undefined) return null;

    return (
      <Text color={SemanticColors.text.accent}>
        {displayTPM < 1000
          ? `TPM: ${displayTPM.toFixed(2)}`
          : `TPM: ${(displayTPM / 1000).toFixed(2)}k`}
      </Text>
    );
  },
);
DebouncedTPMDisplay.displayName = 'DebouncedTPMDisplay';

// Debounced Wait Time Display
const DebouncedWaitDisplay = React.memo<{ throttleWaitTimeMs?: number }>(
  ({ throttleWaitTimeMs }) => {
    const [displayWait, setDisplayWait] = useState<number | undefined>(
      throttleWaitTimeMs,
    );

    useEffect(() => {
      // Debounce wait time updates
      const timeoutId = setTimeout(() => {
        setDisplayWait(throttleWaitTimeMs);
      }, 300); // 300ms debounce

      return () => clearTimeout(timeoutId);
    }, [throttleWaitTimeMs]);

    if (displayWait === undefined) return null;

    return (
      <Text color={SemanticColors.status.warning}>
        {displayWait < 1000
          ? `Wait: ${displayWait}ms`
          : displayWait < 60000
            ? `Wait: ${(displayWait / 1000).toFixed(1)}s`
            : `Wait: ${(displayWait / 60000).toFixed(1)}m`}
      </Text>
    );
  },
);
DebouncedWaitDisplay.displayName = 'DebouncedWaitDisplay';

// Responsive Timestamp Display - Isolated component for clock updates
const ResponsiveTimestamp = React.memo(() => {
  // Initialize with immediate value to avoid empty render in tests
  const initialTime = new Date().toTimeString().slice(0, 8); // HH:MM:SS
  const [time, setTime] = useState<string>(initialTime);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toTimeString().slice(0, 8)); // HH:MM:SS
    };

    const intervalId = setInterval(updateTime, 1000);
    // Don't call updateTime immediately since we have initial value
    return () => clearInterval(intervalId);
  }, []);

  return <Text color={SemanticColors.text.secondary}>{time}</Text>;
});
ResponsiveTimestamp.displayName = 'ResponsiveTimestamp';

export const Footer = React.memo<FooterProps>(
  ({
    model,
    targetDir,
    branchName,
    debugMode,
    debugMessage,
    errorCount,
    showErrorDetails,
    showMemoryUsage,
    historyTokenCount,
    isPaidMode,
    nightly,
    vimMode,
    contextLimit,
    isTrustedFolder,
    tokensPerMinute,
    throttleWaitTimeMs,
    sessionTokenTotal,
    hideCWD = false,
    hideSandboxStatus = false,
    hideModelInfo = false,
  }) => {
    const { breakpoint } = useResponsive();
    const runtime = useRuntimeApi();

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
      <Box flexDirection="column" width="100%">
        {/* First Line: Branch (left) | Memory | Context | Time (right) */}
        <Box justifyContent="space-between" width="100%" alignItems="center">
          {/* Left: Branch Display */}
          <Box flexDirection="row" alignItems="center">
            {branchName && (
              <>
                {nightly ? (
                  <Gradient colors={Colors.GradientColors}>
                    <Text>
                      (
                      {branchName.length > maxBranchLength
                        ? truncateMiddle(branchName, maxBranchLength)
                        : branchName}
                      *)
                    </Text>
                  </Gradient>
                ) : (
                  <Text color={SemanticColors.text.accent}>
                    (
                    {branchName.length > maxBranchLength
                      ? truncateMiddle(branchName, maxBranchLength)
                      : branchName}
                    *)
                  </Text>
                )}
              </>
            )}
            {isTrustedFolder === false && (
              <Text color={SemanticColors.status.warning}> (untrusted)</Text>
            )}
            {debugMode && (
              <>
                <DebugProfiler />
                <Text color={SemanticColors.status.error}>
                  {' ' + (debugMessage || '--debug')}
                </Text>
              </>
            )}
            {vimMode && (
              <Text color={SemanticColors.text.secondary}>[{vimMode}] </Text>
            )}
          </Box>

          {/* Right: Memory | Context | TPM | Wait Time | Time */}
          {!hideModelInfo && (
            <Box flexDirection="row" alignItems="center">
              {showMemoryUsage && (
                <>
                  <ResponsiveMemoryDisplay
                    compact={isCompact}
                    detailed={isDetailed}
                  />
                  <Text color={SemanticColors.text.secondary}> | </Text>
                </>
              )}

              <ResponsiveContextDisplay
                historyTokenCount={historyTokenCount}
                model={model}
                contextLimit={contextLimit}
                compact={isCompact}
                detailed={isDetailed}
              />

              {/* Token tracking metrics - Debounced */}
              {tokensPerMinute !== undefined && (
                <>
                  <Text color={SemanticColors.text.secondary}> | </Text>
                  <DebouncedTPMDisplay tokensPerMinute={tokensPerMinute} />
                </>
              )}

              {throttleWaitTimeMs !== undefined && (
                <>
                  <Text color={SemanticColors.text.secondary}> | </Text>
                  <DebouncedWaitDisplay
                    throttleWaitTimeMs={throttleWaitTimeMs}
                  />
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
          )}
        </Box>

        {/* Second Line: Path (left) | Model | Session Tokens (right) */}
        <Box justifyContent="space-between" width="100%" alignItems="center">
          {/* Left: Path and Sandbox Info */}
          {!hideCWD && (
            <Box flexDirection="row" alignItems="center">
              {nightly ? (
                <Gradient colors={Colors.GradientColors}>
                  <Text>
                    {shortenPath(tildeifyPath(targetDir), isCompact ? 30 : 70)}
                  </Text>
                </Gradient>
              ) : (
                <Text color={SemanticColors.text.secondary}>
                  {shortenPath(tildeifyPath(targetDir), isCompact ? 30 : 70)}
                </Text>
              )}

              {/* Sandbox info (only show at standard+ widths) */}
              {!isCompact && !hideSandboxStatus && (
                <Box marginLeft={2}>
                  {process.env.SANDBOX &&
                  process.env.SANDBOX !== 'sandbox-exec' ? (
                    <Text color={SemanticColors.status.success}>
                      [{process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}]
                    </Text>
                  ) : process.env.SANDBOX === 'sandbox-exec' ? (
                    <Text color={SemanticColors.status.warning}>
                      [macOS Seatbelt{' '}
                      <Text color={SemanticColors.text.secondary}>
                        ({process.env.SEATBELT_PROFILE})
                      </Text>
                      ]
                    </Text>
                  ) : (
                    <Text color={SemanticColors.status.error}>
                      [no sandbox{' '}
                      <Text color={SemanticColors.text.secondary}>
                        (see /docs)
                      </Text>
                      ]
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          )}

          {/* Right: Model, Session Tokens and other status */}
          {!hideModelInfo && (
            <Box flexDirection="row" alignItems="center">
              {/* Show model name */}
              {showModelName && (
                <Text color={SemanticColors.text.accent}>{model}</Text>
              )}

              {/* Show paid/free mode for Gemini provider */}
              {isPaidMode !== undefined &&
                (() => {
                  const status = runtime.getActiveProviderStatus();
                  if (status.providerName === 'gemini') {
                    return (
                      <>
                        {showModelName && (
                          <Text color={SemanticColors.text.secondary}> | </Text>
                        )}
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

              {/* Show session token total */}
              {sessionTokenTotal !== undefined && (
                <>
                  <Text color={SemanticColors.text.secondary}> | </Text>
                  <Text color={SemanticColors.text.accent}>
                    Tokens: {sessionTokenTotal.toLocaleString()}
                  </Text>
                </>
              )}

              {/* Show error count */}
              {!showErrorDetails && errorCount > 0 && (
                <>
                  <Text color={SemanticColors.text.secondary}> | </Text>
                  <ConsoleSummaryDisplay errorCount={errorCount} />
                </>
              )}
            </Box>
          )}
        </Box>
      </Box>
    );
  },
  (prevProps, nextProps) =>
    // Custom comparison function - ignore rapidly changing values
    // Only re-render if important props change
    prevProps.model === nextProps.model &&
    prevProps.targetDir === nextProps.targetDir &&
    prevProps.branchName === nextProps.branchName &&
    prevProps.debugMode === nextProps.debugMode &&
    prevProps.debugMessage === nextProps.debugMessage &&
    prevProps.errorCount === nextProps.errorCount &&
    prevProps.showErrorDetails === nextProps.showErrorDetails &&
    prevProps.showMemoryUsage === nextProps.showMemoryUsage &&
    prevProps.historyTokenCount === nextProps.historyTokenCount &&
    prevProps.isPaidMode === nextProps.isPaidMode &&
    prevProps.nightly === nextProps.nightly &&
    prevProps.vimMode === nextProps.vimMode &&
    prevProps.contextLimit === nextProps.contextLimit &&
    prevProps.isTrustedFolder === nextProps.isTrustedFolder,
  // Ignore rapidly changing values - TPM, wait time, and session tokens
);
Footer.displayName = 'Footer';
