/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface LogEntry {
  timestamp: string;
  type: 'request' | 'response' | 'tool_call';
  provider: string;
  model?: string;
  conversationId?: string;
  messages?: Array<{
    role: string;
    content: string;
  }>;
  response?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
  error?: string;
  // Tool call specific fields
  tool?: string;
  duration?: number;
  success?: boolean;
  gitStats?: {
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
  };
}

interface LoggingDialogProps {
  entries: LogEntry[];
  onClose: () => void;
}

const formatTimestamp = (timestamp: string, isNarrow: boolean): string => {
  const date = new Date(timestamp);
  if (isNarrow) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const formatContent = (content: string, maxLength: number): string => {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.substring(0, maxLength - 3) + '...';
};

const formatTokenCount = (tokens?: {
  input?: number;
  output?: number;
}): string => {
  if (tokens === undefined) return '';
  const parts: string[] = [];
  if (tokens.input !== undefined) parts.push(`in:${tokens.input}`);
  if (tokens.output !== undefined) parts.push(`out:${tokens.output}`);
  return parts.length > 0 ? `[${parts.join(' ')}]` : '';
};

function getEntryMetadata(entry: LogEntry, isNarrow: boolean) {
  const timestamp = formatTimestamp(entry.timestamp, isNarrow);
  const typeIcon =
    entry.type === 'request'
      ? '→'
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        entry.type === 'tool_call'
        ? '[TOOL]'
        : '←';
  const typeColor =
    entry.type === 'request'
      ? SemanticColors.text.accent
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        entry.type === 'tool_call'
        ? SemanticColors.status.warning
        : SemanticColors.status.success;
  return { timestamp, typeIcon, typeColor };
}

function buildToolCallContent(entry: LogEntry): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty tool name should fall back to 'Unknown tool'
  let toolContent = `${entry.tool || 'Unknown tool'}`;
  if (entry.duration !== undefined && entry.duration > 0) {
    toolContent += ` (${entry.duration}ms)`;
  }
  if (entry.success === false) {
    toolContent += ' FAILED';
  }
  if (entry.gitStats) {
    const { linesAdded, linesRemoved, filesChanged } = entry.gitStats;
    toolContent += ` [+${linesAdded} -${linesRemoved} in ${filesChanged} files]`;
  }
  return toolContent;
}

function getEntryMainContent(entry: LogEntry, contentWidth: number): string {
  if (entry.type === 'request' && entry.messages) {
    const lastMessage = entry.messages.at(-1);
    if (lastMessage) {
      return formatContent(lastMessage.content, contentWidth);
    }
  } else if (entry.type === 'response' && entry.response) {
    return formatContent(entry.response, contentWidth);
  } else if (entry.type === 'tool_call') {
    return formatContent(buildToolCallContent(entry), contentWidth);
  } else if (entry.error) {
    return `Error: ${entry.error}`;
  }
  return '';
}

interface LogEntryRowProps {
  entry: LogEntry;
  isSelected: boolean;
  isNarrow: boolean;
  dialogWidth: number;
  globalIndex: number;
}

const LogEntryRow: React.FC<LogEntryRowProps> = ({
  entry,
  isSelected,
  isNarrow,
  dialogWidth,
  globalIndex,
}) => {
  const { timestamp, typeIcon, typeColor } = getEntryMetadata(entry, isNarrow);
  const metadataWidth = timestamp.length + entry.provider.length + 10;
  const contentWidth = dialogWidth - metadataWidth - 4;
  const mainContent = getEntryMainContent(entry, contentWidth);
  const tokens = formatTokenCount(entry.tokens);

  return (
    <Box
      key={`entry-${globalIndex}`}
      flexDirection="column"
      marginBottom={isNarrow ? 0 : 1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color={isSelected ? SemanticColors.status.warning : undefined}>
          {isSelected ? '▶' : ' '}
        </Text>
        <Text color={SemanticColors.text.secondary}>{timestamp}</Text>
        <Text color={typeColor}>{typeIcon}</Text>
        <Text color={SemanticColors.text.primary}>
          {entry.provider}
          {entry.model && !isNarrow && ` (${entry.model})`}
        </Text>
        {tokens && !isNarrow && (
          <Text color={SemanticColors.text.secondary}>{tokens}</Text>
        )}
      </Box>
      {mainContent && (
        <Box paddingLeft={2}>
          <Text
            color={
              entry.error
                ? SemanticColors.status.error
                : SemanticColors.text.secondary
            }
            wrap="wrap"
          >
            {mainContent}
          </Text>
        </Box>
      )}
    </Box>
  );
};

function useLoggingNavigation(
  reversedEntriesLength: number,
  contentHeight: number,
  selectedIndex: number,
  scrollOffset: number,
  setSelectedIndex: (fn: (prev: number) => number) => void,
  setScrollOffset: (fn: (prev: number) => number) => void,
  onClose: () => void,
) {
  useKeypress(
    (key) => {
      if (key.name === 'escape' || key.sequence === 'q') {
        onClose();
        return;
      }
      if (reversedEntriesLength === 0) return;
      if (key.name === 'up' || key.sequence === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
      if (key.name === 'down' || key.sequence === 'j') {
        setSelectedIndex((prev) =>
          Math.min(reversedEntriesLength - 1, prev + 1),
        );
      }
      if (key.name === 'pageup') {
        setSelectedIndex((prev) =>
          Math.max(0, prev - Math.floor(contentHeight / 2)),
        );
      }
      if (key.name === 'pagedown') {
        setSelectedIndex((prev) =>
          Math.min(
            reversedEntriesLength - 1,
            prev + Math.floor(contentHeight / 2),
          ),
        );
      }
      if (key.sequence === 'g') {
        setSelectedIndex(() => 0);
      }
      if (key.sequence === 'G') {
        setSelectedIndex(() => reversedEntriesLength - 1);
      }
    },
    { isActive: true },
  );
}

function useScrollAdjustment(
  selectedIndex: number,
  scrollOffset: number,
  contentHeight: number,
  setScrollOffset: (fn: (prev: number) => number) => void,
) {
  useEffect(() => {
    const relativeIndex = selectedIndex - scrollOffset;
    if (relativeIndex < 0) {
      setScrollOffset(() => selectedIndex);
    } else if (relativeIndex >= contentHeight) {
      setScrollOffset(() => Math.max(0, selectedIndex - contentHeight + 1));
    }
  }, [selectedIndex, scrollOffset, contentHeight, setScrollOffset]);
}

interface LoggingDialogState {
  isNarrow: boolean;
  dialogWidth: number;
  contentHeight: number;
  reversedEntries: LogEntry[];
  visibleEntries: LogEntry[];
  selectedIndex: number;
  scrollOffset: number;
  hasScroll: boolean;
  scrollPercentage: number;
}

function useLoggingDialogState(
  entries: LogEntry[],
  onClose: () => void,
): LoggingDialogState {
  const { isNarrow, width } = useResponsive();
  const { rows: height } = useTerminalSize();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const dialogWidth = isNarrow ? width - 4 : Math.min(width - 8, 120);
  const dialogHeight = Math.min(height - 6, 30);
  const contentHeight = dialogHeight - 6;

  const reversedEntries = useMemo(() => [...entries].reverse(), [entries]);

  const visibleEntries = useMemo(() => {
    const start = scrollOffset;
    const end = Math.min(start + contentHeight, reversedEntries.length);
    return reversedEntries.slice(start, end);
  }, [reversedEntries, scrollOffset, contentHeight]);

  useScrollAdjustment(
    selectedIndex,
    scrollOffset,
    contentHeight,
    setScrollOffset,
  );
  useLoggingNavigation(
    reversedEntries.length,
    contentHeight,
    selectedIndex,
    scrollOffset,
    setSelectedIndex,
    setScrollOffset,
    onClose,
  );

  const hasScroll = reversedEntries.length > contentHeight;
  const scrollPercentage = hasScroll
    ? Math.round(
        ((scrollOffset + contentHeight) / reversedEntries.length) * 100,
      )
    : 100;

  return {
    isNarrow,
    dialogWidth,
    contentHeight,
    reversedEntries,
    visibleEntries,
    selectedIndex,
    scrollOffset,
    hasScroll,
    scrollPercentage,
  };
}

const LoggingDialogHeader: React.FC<{
  dialogWidth: number;
  entryCount: number;
}> = ({ dialogWidth, entryCount }) => (
  <>
    <Box
      paddingX={1}
      paddingY={0}
      borderStyle="round"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderTop={false}
    >
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Text color={SemanticColors.text.primary} bold>
          Conversation Logs
        </Text>
        <Text color={SemanticColors.text.secondary}>{entryCount} entries</Text>
      </Box>
    </Box>
    <Box paddingX={1}>
      <Text color={SemanticColors.border.default}>
        {'─'.repeat(dialogWidth - 4)}
      </Text>
    </Box>
  </>
);

const LoggingDialogFooter: React.FC<{
  dialogWidth: number;
  isNarrow: boolean;
  hasScroll: boolean;
  scrollPercentage: number;
}> = ({ dialogWidth, isNarrow, hasScroll, scrollPercentage }) => (
  <>
    <Box paddingX={1}>
      <Text color={SemanticColors.border.default}>
        {'─'.repeat(dialogWidth - 4)}
      </Text>
    </Box>
    <Box paddingX={1} paddingBottom={0}>
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Text color={SemanticColors.text.secondary}>
          {isNarrow ? '↑↓ Nav' : '↑↓ Navigate'} {!isNarrow && 'g/G Top/Bottom '}
          ESC Close
        </Text>
        {hasScroll && (
          <Text color={SemanticColors.text.secondary}>{scrollPercentage}%</Text>
        )}
      </Box>
    </Box>
  </>
);

export const LoggingDialog: React.FC<LoggingDialogProps> = ({
  entries,
  onClose,
}) => {
  const state = useLoggingDialogState(entries, onClose);

  return (
    <Box
      flexDirection="column"
      width={state.dialogWidth}
      borderStyle="round"
      borderColor={SemanticColors.border.default}
    >
      <LoggingDialogHeader
        dialogWidth={state.dialogWidth}
        entryCount={state.reversedEntries.length}
      />
      <Box
        flexDirection="column"
        height={state.contentHeight}
        paddingX={1}
        overflow="hidden"
      >
        {state.visibleEntries.length > 0 ? (
          state.visibleEntries.map((entry, index) => (
            <LogEntryRow
              key={state.scrollOffset + index}
              entry={entry}
              isSelected={state.scrollOffset + index === state.selectedIndex}
              isNarrow={state.isNarrow}
              dialogWidth={state.dialogWidth}
              globalIndex={state.scrollOffset + index}
            />
          ))
        ) : (
          <Box justifyContent="center" alignItems="center" height="100%">
            <Text color={SemanticColors.text.secondary}>
              No log entries found
            </Text>
          </Box>
        )}
      </Box>
      <LoggingDialogFooter
        dialogWidth={state.dialogWidth}
        isNarrow={state.isNarrow}
        hasScroll={state.hasScroll}
        scrollPercentage={state.scrollPercentage}
      />
    </Box>
  );
};
