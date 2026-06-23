/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.1
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
import v8 from 'node:v8';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugProfiler } from './DebugProfiler.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateMiddle } from '../utils/responsive.js';
import { ThemedGradient } from './ThemedGradient.js';

const DEFAULT_HEAP_LIMIT = 4.8 * 1024 * 1024 * 1024;
const rawHeapLimit = v8.getHeapStatistics().heap_size_limit;
const heapSizeLimit = rawHeapLimit > 0 ? rawHeapLimit : DEFAULT_HEAP_LIMIT;

function areFooterStablePropsEqual(
  prevProps: FooterProps,
  nextProps: FooterProps,
): boolean {
  const stableProps: Array<keyof FooterProps> = [
    'model',
    'targetDir',
    'branchName',
    'debugMode',
    'debugMessage',
    'errorCount',
    'showErrorDetails',
    'showMemoryUsage',
    'historyTokenCount',
    'isPaidMode',
    'nightly',
    'vimMode',
    'contextLimit',
    'isTrustedFolder',
    'hideCWD',
    'hideSandboxStatus',
    'hideModelInfo',
    'themeName',
  ];

  return stableProps.every((prop) => prevProps[prop] === nextProps[prop]);
}

interface FooterProps {
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
  // Theme tracking for memo invalidation
  themeName?: string;
  // Footer visibility settings
  hideCWD?: boolean;
  hideSandboxStatus?: boolean;
  hideModelInfo?: boolean;
}

// Responsive Memory Usage Display - Memoized to prevent re-renders
interface ResponsiveMemoryDisplayProps {
  compact: boolean;
  detailed: boolean;
}

const ResponsiveMemoryDisplay = React.memo(
  ({ compact, detailed }: ResponsiveMemoryDisplayProps) => {
    const initialUsage = process.memoryUsage().rss;
    const initialPercentage = Math.round((initialUsage / heapSizeLimit) * 100);

    let initialText: string;
    if (detailed) {
      const usageGB = (initialUsage / (1024 * 1024 * 1024)).toFixed(1);
      const totalGB = (heapSizeLimit / (1024 * 1024 * 1024)).toFixed(1);
      initialText = `Memory: ${initialPercentage}% (${usageGB}GB/${totalGB}GB)`;
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
        const percentage = Math.round((usage / heapSizeLimit) * 100);

        if (detailed) {
          const usageGB = (usage / (1024 * 1024 * 1024)).toFixed(1);
          const totalGB = (heapSizeLimit / (1024 * 1024 * 1024)).toFixed(1);
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
      return () => clearInterval(intervalId);
    }, [compact, detailed]);

    return <Text color={memoryUsageColor}>{memoryUsage}</Text>;
  },
);
ResponsiveMemoryDisplay.displayName = 'ResponsiveMemoryDisplay';

// Responsive Context Usage Display - Memoized to prevent re-renders
interface ResponsiveContextDisplayProps {
  historyTokenCount: number;
  model: string;
  contextLimit?: number;
  compact: boolean;
  detailed: boolean;
}

const ResponsiveContextDisplay = React.memo(
  ({
    historyTokenCount,
    model,
    contextLimit,
    compact,
    detailed,
  }: ResponsiveContextDisplayProps) => {
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
  },
);
ResponsiveContextDisplay.displayName = 'ResponsiveContextDisplay';

// Debounced TPM Display - Updates less frequently to reduce flicker
interface DebouncedTPMDisplayProps {
  tokensPerMinute?: number;
  themeName?: string;
}

const DebouncedTPMDisplay = React.memo(
  ({ tokensPerMinute }: DebouncedTPMDisplayProps) => {
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
interface DebouncedWaitDisplayProps {
  throttleWaitTimeMs?: number;
  themeName?: string;
}

const DebouncedWaitDisplay = React.memo(
  ({ throttleWaitTimeMs }: DebouncedWaitDisplayProps) => {
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

    let waitText: string;
    if (displayWait < 1000) {
      waitText = `Wait: ${displayWait}ms`;
    } else if (displayWait < 60000) {
      waitText = `Wait: ${(displayWait / 1000).toFixed(1)}s`;
    } else {
      waitText = `Wait: ${(displayWait / 60000).toFixed(1)}m`;
    }

    return <Text color={SemanticColors.status.warning}>{waitText}</Text>;
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

// Branch display sub-component
interface BranchDisplayProps {
  branchName: string;
  nightly: boolean;
  maxBranchLength: number;
}

const BranchDisplay = React.memo(
  ({ branchName, nightly, maxBranchLength }: BranchDisplayProps) => {
    const displayBranch =
      branchName.length > maxBranchLength
        ? truncateMiddle(branchName, maxBranchLength)
        : branchName;
    if (nightly) {
      return (
        <ThemedGradient colors={Colors.GradientColors}>
          <Text color={Colors.Foreground}>({displayBranch}*)</Text>
        </ThemedGradient>
      );
    }
    return <Text color={SemanticColors.text.accent}>({displayBranch}*)</Text>;
  },
);
BranchDisplay.displayName = 'BranchDisplay';

// Model name sub-component with load-balancer logic
interface ModelNameDisplayProps {
  model: string;
  showModelName: boolean;
  runtime: ReturnType<typeof useRuntimeApi>;
}

const ModelNameDisplay = React.memo(
  ({ model, showModelName, runtime }: ModelNameDisplayProps) => {
    if (!showModelName) return null;
    const providerStatus = runtime.getActiveProviderStatus();
    const lbDisplay = tryGetLBDisplayName(runtime, providerStatus);
    if (lbDisplay !== null) return lbDisplay;
    return <Text color={SemanticColors.text.primary}>{model}</Text>;
  },
);
ModelNameDisplay.displayName = 'ModelNameDisplay';

function tryGetLBDisplayName(
  runtime: ReturnType<typeof useRuntimeApi>,
  providerStatus: { providerName: string | null },
): React.ReactNode | null {
  if (providerStatus.providerName !== 'load-balancer') return null;
  try {
    const providerManager = runtime.getCliProviderManager();
    const lbProvider = providerManager.getProviderByName('load-balancer');
    if (
      lbProvider &&
      'getStats' in lbProvider &&
      typeof (lbProvider as { getStats?: () => unknown }).getStats ===
        'function'
    ) {
      const lbStats = (
        lbProvider as {
          getStats: () => {
            lastSelected: string | null;
            profileName: string;
          };
        }
      ).getStats();
      if (lbStats.lastSelected) {
        return (
          <>
            <Text color={SemanticColors.text.primary}>
              {lbStats.lastSelected}
            </Text>
            <Text color={SemanticColors.text.secondary}>
              {' '}
              via {lbStats.profileName}
            </Text>
          </>
        );
      }
    }
  } catch {
    // Silently ignore errors fetching LB stats in the footer
  }
  return null;
}

// Paid/free mode sub-component
interface PaidModeDisplayProps {
  isPaidMode: boolean | undefined;
  showModelName: boolean;
  runtime: ReturnType<typeof useRuntimeApi>;
}

const PaidModeDisplay = React.memo(
  ({ isPaidMode, showModelName, runtime }: PaidModeDisplayProps) => {
    if (isPaidMode === undefined) return null;
    const status = runtime.getActiveProviderStatus();
    if (status.providerName !== 'gemini') return null;
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
  },
);
PaidModeDisplay.displayName = 'PaidModeDisplay';

// Sandbox status sub-component
interface SandboxStatusDisplayProps {
  hideSandboxStatus: boolean;
  isCompact: boolean;
}

const SandboxStatusDisplay = React.memo(
  ({ hideSandboxStatus, isCompact }: SandboxStatusDisplayProps) => {
    if (isCompact || hideSandboxStatus) return null;

    let sandboxStatus: React.ReactNode;
    if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
      sandboxStatus = (
        <Text color={SemanticColors.status.success}>
          [{process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}]
        </Text>
      );
    } else if (process.env.SANDBOX === 'sandbox-exec') {
      sandboxStatus = (
        <Text color={SemanticColors.status.warning}>
          [macOS Seatbelt{' '}
          <Text color={SemanticColors.text.secondary}>
            ({process.env.SEATBELT_PROFILE})
          </Text>
          ]
        </Text>
      );
    } else {
      sandboxStatus = (
        <Text color={SemanticColors.status.error}>
          [no sandbox{' '}
          <Text color={SemanticColors.text.secondary}>(see /docs)</Text>]
        </Text>
      );
    }

    return <Box marginLeft={2}>{sandboxStatus}</Box>;
  },
);
SandboxStatusDisplay.displayName = 'SandboxStatusDisplay';

// Right side: Memory | Context | TPM | Wait Time | Time
interface FooterMetricsRowProps {
  hideModelInfo: boolean;
  showMemoryUsage?: boolean;
  isCompact: boolean;
  isDetailed: boolean;
  historyTokenCount: number;
  model: string;
  contextLimit?: number;
  tokensPerMinute?: number;
  throttleWaitTimeMs?: number;
  themeName?: string;
  showTimestamp: boolean;
}

const FooterMetricsRow = React.memo(
  ({
    hideModelInfo,
    showMemoryUsage,
    isCompact,
    isDetailed,
    historyTokenCount,
    model,
    contextLimit,
    tokensPerMinute,
    throttleWaitTimeMs,
    themeName,
    showTimestamp,
  }: FooterMetricsRowProps) => {
    if (hideModelInfo) return null;
    return (
      <Box flexDirection="row" alignItems="center">
        {(showMemoryUsage ?? false) && (
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
        {tokensPerMinute !== undefined && (
          <>
            <Text color={SemanticColors.text.secondary}> | </Text>
            <DebouncedTPMDisplay
              tokensPerMinute={tokensPerMinute}
              themeName={themeName}
            />
          </>
        )}
        {throttleWaitTimeMs !== undefined && (
          <>
            <Text color={SemanticColors.text.secondary}> | </Text>
            <DebouncedWaitDisplay
              throttleWaitTimeMs={throttleWaitTimeMs}
              themeName={themeName}
            />
          </>
        )}
        {showTimestamp && (
          <>
            <Text color={SemanticColors.text.secondary}> | </Text>
            <ResponsiveTimestamp />
          </>
        )}
      </Box>
    );
  },
);
FooterMetricsRow.displayName = 'FooterMetricsRow';

// Footer first line: Branch (left) | Memory | Context | Time (right)
interface FooterFirstLineProps {
  branchName?: string;
  nightly: boolean;
  isTrustedFolder?: boolean;
  debugMode: boolean;
  debugMessage: string;
  vimMode?: string;
  maxBranchLength: number;
  hideModelInfo: boolean;
  showMemoryUsage?: boolean;
  isCompact: boolean;
  isDetailed: boolean;
  historyTokenCount: number;
  model: string;
  contextLimit?: number;
  tokensPerMinute?: number;
  throttleWaitTimeMs?: number;
  themeName?: string;
  showTimestamp: boolean;
}

const FooterFirstLine = React.memo((props: FooterFirstLineProps) => {
  const {
    branchName,
    nightly,
    isTrustedFolder,
    debugMode,
    debugMessage,
    vimMode,
    maxBranchLength,
    hideModelInfo,
    showMemoryUsage,
    isCompact,
    isDetailed,
    historyTokenCount,
    model,
    contextLimit,
    tokensPerMinute,
    throttleWaitTimeMs,
    themeName,
    showTimestamp,
  } = props;
  return (
    <Box justifyContent="space-between" width="100%" alignItems="center">
      <Box flexDirection="row" alignItems="center">
        {branchName && (
          <BranchDisplay
            branchName={branchName}
            nightly={nightly}
            maxBranchLength={maxBranchLength}
          />
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
      <FooterMetricsRow
        hideModelInfo={hideModelInfo}
        showMemoryUsage={showMemoryUsage}
        isCompact={isCompact}
        isDetailed={isDetailed}
        historyTokenCount={historyTokenCount}
        model={model}
        contextLimit={contextLimit}
        tokensPerMinute={tokensPerMinute}
        throttleWaitTimeMs={throttleWaitTimeMs}
        themeName={themeName}
        showTimestamp={showTimestamp}
      />
    </Box>
  );
});
FooterFirstLine.displayName = 'FooterFirstLine';

// Footer second line: Path (left) | Model | Session Tokens (right)
interface FooterSecondLineProps {
  hideCWD: boolean;
  nightly: boolean;
  targetDir: string;
  isCompact: boolean;
  hideSandboxStatus: boolean;
  hideModelInfo: boolean;
  showModelName: boolean;
  model: string;
  runtime: ReturnType<typeof useRuntimeApi>;
  isPaidMode: boolean | undefined;
  sessionTokenTotal: number | undefined;
  showErrorDetails: boolean;
  errorCount: number;
}

const FooterSecondLine = React.memo((props: FooterSecondLineProps) => {
  const {
    hideCWD,
    nightly,
    targetDir,
    isCompact,
    hideSandboxStatus,
    hideModelInfo,
    showModelName,
    model,
    runtime,
    isPaidMode,
    sessionTokenTotal,
    showErrorDetails,
    errorCount,
  } = props;
  return (
    <Box justifyContent="space-between" width="100%" alignItems="center">
      {!hideCWD && (
        <Box flexDirection="row" alignItems="center">
          {nightly ? (
            <ThemedGradient colors={Colors.GradientColors}>
              <Text color={Colors.Foreground}>
                {shortenPath(tildeifyPath(targetDir), isCompact ? 30 : 70)}
              </Text>
            </ThemedGradient>
          ) : (
            <Text color={SemanticColors.text.secondary}>
              {shortenPath(tildeifyPath(targetDir), isCompact ? 30 : 70)}
            </Text>
          )}
          <SandboxStatusDisplay
            hideSandboxStatus={hideSandboxStatus}
            isCompact={isCompact}
          />
        </Box>
      )}
      {!hideModelInfo && (
        <Box flexDirection="row" alignItems="center">
          <ModelNameDisplay
            model={model}
            showModelName={showModelName}
            runtime={runtime}
          />
          <PaidModeDisplay
            isPaidMode={isPaidMode}
            showModelName={showModelName}
            runtime={runtime}
          />
          {sessionTokenTotal !== undefined && (
            <>
              <Text color={SemanticColors.text.secondary}> | </Text>
              <Text color={SemanticColors.text.accent}>
                Tokens: {sessionTokenTotal.toLocaleString()}
              </Text>
            </>
          )}
          {!showErrorDetails && errorCount > 0 && (
            <>
              <Text color={SemanticColors.text.secondary}> | </Text>
              <ConsoleSummaryDisplay errorCount={errorCount} />
            </>
          )}
        </Box>
      )}
    </Box>
  );
});
FooterSecondLine.displayName = 'FooterSecondLine';

function getMaxBranchLength(breakpoint: string): number {
  if (breakpoint === 'NARROW') return 15;
  if (breakpoint === 'STANDARD') return 35;
  return 100;
}

export const Footer = React.memo(
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
    themeName,
    hideCWD = false,
    hideSandboxStatus = false,
    hideModelInfo = false,
  }: FooterProps) => {
    const { breakpoint } = useResponsive();
    const runtime = useRuntimeApi();
    const showTimestamp = breakpoint === 'WIDE';
    const showModelName = breakpoint !== 'NARROW';
    const isCompact = breakpoint === 'NARROW';
    const isDetailed = breakpoint === 'WIDE';
    const maxBranchLength = getMaxBranchLength(breakpoint);

    return (
      <Box flexDirection="column" width="100%">
        <FooterFirstLine
          branchName={branchName}
          nightly={nightly}
          isTrustedFolder={isTrustedFolder}
          debugMode={debugMode}
          debugMessage={debugMessage}
          vimMode={vimMode}
          maxBranchLength={maxBranchLength}
          hideModelInfo={hideModelInfo}
          showMemoryUsage={showMemoryUsage}
          isCompact={isCompact}
          isDetailed={isDetailed}
          historyTokenCount={historyTokenCount}
          model={model}
          contextLimit={contextLimit}
          tokensPerMinute={tokensPerMinute}
          throttleWaitTimeMs={throttleWaitTimeMs}
          themeName={themeName}
          showTimestamp={showTimestamp}
        />
        <FooterSecondLine
          hideCWD={hideCWD}
          nightly={nightly}
          targetDir={targetDir}
          isCompact={isCompact}
          hideSandboxStatus={hideSandboxStatus}
          hideModelInfo={hideModelInfo}
          showModelName={showModelName}
          model={model}
          runtime={runtime}
          isPaidMode={isPaidMode}
          sessionTokenTotal={sessionTokenTotal}
          showErrorDetails={showErrorDetails}
          errorCount={errorCount}
        />
      </Box>
    );
  },
  areFooterStablePropsEqual,
);
Footer.displayName = 'Footer';
