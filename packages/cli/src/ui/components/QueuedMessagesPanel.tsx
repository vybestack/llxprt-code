/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentRequestInput,
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core';
import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { truncateEnd } from '../utils/responsive.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { QueuedSubmission } from '../hooks/agentStream/types.js';

interface QueuedMessagesPanelProps {
  width: number;
  collapsed?: boolean;
  messages: readonly QueuedSubmission[];
}

export type QueuedMessagesPanelView =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'compact';
      readonly width: number;
      readonly summary: string;
    }
  | {
      readonly kind: 'collapsed';
      readonly width: number;
      readonly panelHeight: number;
      readonly summary: string;
      readonly nextPreview?: string;
    }
  | {
      readonly kind: 'expanded';
      readonly width: number;
      readonly panelHeight: number;
      readonly heading: string;
      readonly messages: ReadonlyArray<{
        readonly key: string;
        readonly number: number;
        readonly preview: string;
      }>;
      readonly moreCount: number;
    };

/**
 * Extract a human-readable preview string from any AgentRequestInput variant.
 */
export function extractPreviewText(query: AgentRequestInput): string {
  if (typeof query === 'string') {
    return query;
  }

  if (Array.isArray(query)) {
    if (query.length === 0) {
      return '(empty message)';
    }

    if (isIContentArray(query)) {
      return extractTextFromTurns(query);
    }

    const text = extractTextFromBlocks(query as ContentBlock[]);
    return text.length > 0 ? text : '(non-text message)';
  }

  if (isIContent(query)) {
    const text = extractTextFromBlocks(query.blocks);
    return text.length > 0 ? text : '(non-text turn)';
  }

  return '(non-text message)';
}

function extractTextFromTurns(turns: IContent[]): string {
  const text = turns
    .map((turn) => extractTextFromBlocks(turn.blocks))
    .filter((part) => part.length > 0)
    .join(' ');
  return text.length > 0 ? text : '(non-text turn)';
}

function extractTextFromBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (isTextBlock(block)) {
      parts.push(block.text);
    }
  }
  return parts.join(' ');
}

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  if (typeof block !== 'object' || block === null) {
    return false;
  }
  const candidate = block as Record<string, unknown>;
  return candidate.type === 'text' && typeof candidate.text === 'string';
}

function isIContent(value: unknown): value is IContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.speaker === 'human' ||
      candidate.speaker === 'ai' ||
      candidate.speaker === 'tool') &&
    Array.isArray(candidate.blocks)
  );
}

function isIContentArray(value: unknown): value is IContent[] {
  return Array.isArray(value) && value.every((item) => isIContent(item));
}

function stableKey(message: QueuedSubmission, index: number): string {
  if (message.promptId) {
    return `queued-${message.promptId}`;
  }
  const preview = extractPreviewText(message.query);
  return `queued-${index}-${preview.slice(0, 20)}`;
}

function calculatePanelHeight(rows: number): number {
  return Math.max(1, Math.floor(rows * 0.2));
}

function calculateMaxVisibleItems(
  panelHeight: number,
  messageCount: number,
): number {
  const borderRows = panelHeight > 1 ? 1 : 0;
  const headerRows = 1;
  const availableRows = Math.max(0, panelHeight - borderRows - headerRows);
  return messageCount <= availableRows
    ? availableRows
    : Math.max(0, availableRows - 1);
}

export function prepareQueuedMessagesPanelView({
  width,
  collapsed = false,
  messages,
  columns,
  rows,
}: QueuedMessagesPanelProps & {
  columns: number;
  rows: number;
}): QueuedMessagesPanelView {
  if (messages.length === 0) {
    return { kind: 'empty' };
  }

  const panelHeight = calculatePanelHeight(rows);
  const boundedWidth = Math.max(1, Math.min(width, columns));

  if (panelHeight === 1) {
    const messageLabel = messages.length === 1 ? 'message' : 'messages';
    return {
      kind: 'compact',
      width: boundedWidth,
      summary: `${messages.length} queued ${messageLabel}`,
    };
  }

  if (collapsed) {
    return {
      kind: 'collapsed',
      width: boundedWidth,
      panelHeight,
      summary: `${messages.length} queued`,
      nextPreview:
        messages.length > 1
          ? truncateEnd(
              extractPreviewText(messages[0].query),
              Math.max(1, Math.floor(boundedWidth * 0.55)),
            )
          : undefined,
    };
  }

  const maxVisibleItems = calculateMaxVisibleItems(
    panelHeight,
    messages.length,
  );
  const visibleMessages = messages.slice(0, maxVisibleItems);
  const contentWidth = Math.max(1, boundedWidth - 4);

  return {
    kind: 'expanded',
    width: boundedWidth,
    panelHeight,
    heading: `Queued Messages (${messages.length})`,
    messages: visibleMessages.map((message, index) => ({
      key: stableKey(message, index),
      number: index + 1,
      preview: truncateEnd(extractPreviewText(message.query), contentWidth),
    })),
    moreCount: messages.length - visibleMessages.length,
  };
}

function CompactQueuedMessagesPanel({
  view,
}: {
  view: Extract<QueuedMessagesPanelView, { kind: 'compact' }>;
}) {
  return (
    <Box width={view.width} height={1} overflow="hidden">
      <Text color={SemanticColors.text.accent} bold wrap="truncate-end">
        {view.summary}
      </Text>
    </Box>
  );
}

function CollapsedQueuedMessagesPanel({
  view,
}: {
  view: Extract<QueuedMessagesPanelView, { kind: 'collapsed' }>;
}) {
  return (
    <Box
      flexDirection="column"
      width={view.width}
      height={view.panelHeight}
      overflow="hidden"
      borderStyle="single"
      borderColor={SemanticColors.text.accent}
      borderTop={view.panelHeight > 1}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={view.width > 2 ? 1 : 0}
    >
      <Box flexDirection="row" minHeight={1} overflow="hidden">
        <Text color={SemanticColors.text.primary} bold wrap="truncate-end">
          {view.summary}
        </Text>
        {view.nextPreview !== undefined && (
          <Text color={SemanticColors.text.secondary}>
            {' '}
            • next: {view.nextPreview}
          </Text>
        )}
        <Text color={SemanticColors.text.secondary}> • Ctrl+] to expand</Text>
      </Box>
    </Box>
  );
}

function ExpandedQueuedMessagesPanel({
  view,
}: {
  view: Extract<QueuedMessagesPanelView, { kind: 'expanded' }>;
}) {
  return (
    <Box
      flexDirection="column"
      width={view.width}
      height={view.panelHeight}
      overflow="hidden"
      borderStyle="single"
      borderColor={SemanticColors.text.accent}
      borderTop={view.panelHeight > 1}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={view.width > 2 ? 1 : 0}
    >
      <Box key="header" minHeight={1} marginBottom={0}>
        <Text color={SemanticColors.text.accent} bold>
          {view.heading}
        </Text>
        <Text color={SemanticColors.text.secondary}> • Ctrl+] to minimize</Text>
      </Box>
      {view.messages.map((message) => (
        <Box key={message.key} flexDirection="row" minHeight={1}>
          <Text color={SemanticColors.text.secondary} bold>
            {message.number}.{' '}
          </Text>
          <Box flexGrow={1} overflow="hidden">
            <Text color={SemanticColors.text.secondary} wrap="truncate-end">
              {message.preview}
            </Text>
          </Box>
        </Box>
      ))}
      {view.moreCount > 0 && (
        <Box key="more-indicator" flexDirection="row" minHeight={1}>
          <Text color={SemanticColors.text.secondary}>
            ▼ +{view.moreCount} more
          </Text>
        </Box>
      )}
    </Box>
  );
}

export const QueuedMessagesPanel: React.FC<QueuedMessagesPanelProps> = ({
  width,
  collapsed = false,
  messages,
}) => {
  const { columns, rows } = useTerminalSize();
  const view = useMemo(
    () =>
      prepareQueuedMessagesPanelView({
        width,
        collapsed,
        messages,
        columns,
        rows,
      }),
    [width, collapsed, messages, columns, rows],
  );

  if (view.kind === 'empty') {
    return null;
  }
  if (view.kind === 'compact') {
    return <CompactQueuedMessagesPanel view={view} />;
  }
  if (view.kind === 'collapsed') {
    return <CollapsedQueuedMessagesPanel view={view} />;
  }
  return <ExpandedQueuedMessagesPanel view={view} />;
};
