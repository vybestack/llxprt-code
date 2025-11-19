/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useKeypress } from '../hooks/useKeypress.js';
// Import utility functions for future use
// import { truncateEnd, truncateStart } from '../utils/responsive.js';

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
    // Short format for narrow screens: HH:MM
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } else {
    // Full format for wider screens
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
};

const formatContent = (content: string, maxLength: number): string => {
  // Remove excess whitespace and newlines
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
  if (!tokens) return '';
  const parts: string[] = [];
  if (tokens.input) parts.push(`in:${tokens.input}`);
  if (tokens.output) parts.push(`out:${tokens.output}`);
  return parts.length > 0 ? `[${parts.join(' ')}]` : '';
};

export const LoggingDialog: React.FC<LoggingDialogProps> = ({
  entries,
  onClose,
}) => {
  const { isNarrow, width } = useResponsive();
  const { rows: height } = useTerminalSize();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Calculate dialog dimensions
  const dialogWidth = isNarrow ? width - 4 : Math.min(width - 8, 120);
  const dialogHeight = Math.min(height - 6, 30);
  const contentHeight = dialogHeight - 6; // Account for header, footer, borders

  // Reverse entries to show newest first
  const reversedEntries = useMemo(() => [...entries].reverse(), [entries]);

  // Calculate visible range based on scroll
  const visibleEntries = useMemo(() => {
    const start = scrollOffset;
    const end = Math.min(start + contentHeight, reversedEntries.length);
    return reversedEntries.slice(start, end);
  }, [reversedEntries, scrollOffset, contentHeight]);

  // Adjust scroll when selection moves out of view
  useEffect(() => {
    const relativeIndex = selectedIndex - scrollOffset;
    if (relativeIndex < 0) {
      setScrollOffset(selectedIndex);
    } else if (relativeIndex >= contentHeight) {
      setScrollOffset(Math.max(0, selectedIndex - contentHeight + 1));
    }
  }, [selectedIndex, scrollOffset, contentHeight]);

  useKeypress(
    (key) => {
      if (key.name === 'escape' || key.sequence === 'q') {
        return onClose();
      }

      if (key.name === 'up' || key.sequence === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }

      if (key.name === 'down' || key.sequence === 'j') {
        setSelectedIndex((prev) =>
          Math.min(reversedEntries.length - 1, prev + 1),
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
            reversedEntries.length - 1,
            prev + Math.floor(contentHeight / 2),
          ),
        );
      }

      if (key.sequence === 'g') {
        setSelectedIndex(0);
      }

      if (key.sequence === 'G') {
        setSelectedIndex(reversedEntries.length - 1);
      }
    },
    { isActive: true },
  );

  const renderEntry = (entry: LogEntry, index: number, isSelected: boolean) => {
    const globalIndex = scrollOffset + index;
    const timestamp = formatTimestamp(entry.timestamp, isNarrow);
    const typeIcon =
      entry.type === 'request'
        ? '→'
        : entry.type === 'tool_call'
          ? '[TOOL]'
          : '←';
    const typeColor =
      entry.type === 'request'
        ? SemanticColors.text.accent
        : entry.type === 'tool_call'
          ? SemanticColors.status.warning
          : SemanticColors.status.success;

    // Calculate available width for content
    const metadataWidth = timestamp.length + entry.provider.length + 10; // Icons, spacing
    const contentWidth = dialogWidth - metadataWidth - 4; // Padding

    // Format the main content
    let mainContent = '';
    if (entry.type === 'request' && entry.messages) {
      const lastMessage = entry.messages[entry.messages.length - 1];
      if (lastMessage) {
        mainContent = formatContent(lastMessage.content, contentWidth);
      }
    } else if (entry.type === 'response' && entry.response) {
      mainContent = formatContent(entry.response, contentWidth);
    } else if (entry.type === 'tool_call') {
      // Format tool call content
      let toolContent = `${entry.tool || 'Unknown tool'}`;
      if (entry.duration) {
        toolContent += ` (${entry.duration}ms)`;
      }
      if (entry.success === false) {
        toolContent += ' FAILED';
      }
      // Add git stats if present
      if (entry.gitStats) {
        const { linesAdded, linesRemoved, filesChanged } = entry.gitStats;
        toolContent += ` [+${linesAdded} -${linesRemoved} in ${filesChanged} files]`;
      }
      mainContent = formatContent(toolContent, contentWidth);
    } else if (entry.error) {
      mainContent = `Error: ${entry.error}`;
    }

    const tokens = formatTokenCount(entry.tokens);

    return (
      <Box
        key={`entry-${globalIndex}`}
        flexDirection="column"
        marginBottom={isNarrow ? 0 : 1}
      >
        <Box flexDirection="row" gap={1}>
          {/* Selection indicator */}
          <Text color={isSelected ? SemanticColors.status.warning : undefined}>
            {isSelected ? '▶' : ' '}
          </Text>

          {/* Timestamp */}
          <Text color={SemanticColors.text.secondary}>{timestamp}</Text>

          {/* Type icon */}
          <Text color={typeColor}>{typeIcon}</Text>

          {/* Provider and model */}
          <Text color={SemanticColors.text.primary}>
            {entry.provider}
            {entry.model && !isNarrow && ` (${entry.model})`}
          </Text>

          {/* Token counts */}
          {tokens && !isNarrow && (
            <Text color={SemanticColors.text.secondary}>{tokens}</Text>
          )}
        </Box>

        {/* Content on second line for better readability */}
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

  const hasScroll = reversedEntries.length > contentHeight;
  const scrollPercentage = hasScroll
    ? Math.round(
        ((scrollOffset + contentHeight) / reversedEntries.length) * 100,
      )
    : 100;

  return (
    <Box
      flexDirection="column"
      width={dialogWidth}
      borderStyle="round"
      borderColor={SemanticColors.border.default}
    >
      {/* Header */}
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
          <Text color={SemanticColors.text.secondary}>
            {reversedEntries.length} entries
          </Text>
        </Box>
      </Box>

      {/* Divider */}
      <Box paddingX={1}>
        <Text color={SemanticColors.border.default}>
          {'─'.repeat(dialogWidth - 4)}
        </Text>
      </Box>

      {/* Content area with scroll */}
      <Box
        flexDirection="column"
        height={contentHeight}
        paddingX={1}
        overflow="hidden"
      >
        {visibleEntries.length > 0 ? (
          visibleEntries.map((entry, index) =>
            renderEntry(entry, index, scrollOffset + index === selectedIndex),
          )
        ) : (
          <Box justifyContent="center" alignItems="center" height="100%">
            <Text color={SemanticColors.text.secondary}>
              No log entries found
            </Text>
          </Box>
        )}
      </Box>

      {/* Footer with controls */}
      <Box paddingX={1}>
        <Text color={SemanticColors.border.default}>
          {'─'.repeat(dialogWidth - 4)}
        </Text>
      </Box>
      <Box paddingX={1} paddingBottom={0}>
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text color={SemanticColors.text.secondary}>
            {isNarrow ? '↑↓ Nav' : '↑↓ Navigate'}{' '}
            {!isNarrow && 'g/G Top/Bottom '}
            ESC Close
          </Text>
          {hasScroll && (
            <Text color={SemanticColors.text.secondary}>
              {scrollPercentage}%
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};
