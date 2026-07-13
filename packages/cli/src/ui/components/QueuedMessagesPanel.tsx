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
import { Command, getDefaultKeyBindingHint } from '../../config/keyBindings.js';
import { truncateEnd } from '../utils/responsive.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { QueuedSubmission } from '../hooks/agentStream/types.js';

interface QueuedMessagesPanelProps {
  width: number;
  collapsed?: boolean;
  messages: readonly QueuedSubmission[];
}

const PANEL_HEIGHT_RATIO = 0.2;
const COLLAPSED_PREVIEW_WIDTH_RATIO = 0.55;
const EXPANDED_CONTENT_WIDTH_OFFSET = 4;
const FALLBACK_KEY_PREVIEW_LENGTH = 20;
const MIN_EXPANDED_PANEL_HEIGHT = 3;
const QUEUED_MESSAGES_KEY_HINT = getDefaultKeyBindingHint(
  Command.TOGGLE_QUEUED_MESSAGES,
);

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
      readonly showMoreIndicator: boolean;
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
    if (isTextBlock(block) && block.text.length > 0) {
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
  if (message.promptId != null) {
    return `queued-${message.promptId}`;
  }
  const preview = extractPreviewText(message.query);
  return `queued-${index}-${preview.slice(0, FALLBACK_KEY_PREVIEW_LENGTH)}`;
}

function calculatePanelHeight(rows: number): number {
  return Math.max(1, Math.floor(rows * PANEL_HEIGHT_RATIO));
}

function calculateAvailableRows(panelHeight: number): number {
  const borderRows = panelHeight > 1 ? 1 : 0;
  const headerRows = 1;
  return Math.max(0, panelHeight - borderRows - headerRows);
}

function calculateMaxVisibleItems(
  panelHeight: number,
  messageCount: number,
): number {
  const availableRows = calculateAvailableRows(panelHeight);
  if (messageCount <= availableRows) {
    return messageCount;
  }
  if (availableRows <= 1) {
    return availableRows;
  }
  return availableRows - 1;
}

function queuedMessageSummary(messageCount: number): string {
  return `${messageCount} queued ${messageCount === 1 ? 'message' : 'messages'}`;
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

  if (panelHeight < MIN_EXPANDED_PANEL_HEIGHT && !collapsed) {
    return {
      kind: 'compact',
      width: boundedWidth,
      summary: queuedMessageSummary(messages.length),
    };
  }

  if (panelHeight === 1) {
    return {
      kind: 'compact',
      width: boundedWidth,
      summary: queuedMessageSummary(messages.length),
    };
  }

  if (collapsed) {
    return {
      kind: 'collapsed',
      width: boundedWidth,
      panelHeight,
      summary: queuedMessageSummary(messages.length),
      nextPreview: truncateEnd(
        extractPreviewText(messages[0].query),
        Math.max(1, Math.floor(boundedWidth * COLLAPSED_PREVIEW_WIDTH_RATIO)),
      ),
    };
  }

  const maxVisibleItems = calculateMaxVisibleItems(
    panelHeight,
    messages.length,
  );
  const visibleMessages = messages.slice(0, maxVisibleItems);
  const contentWidth = Math.max(
    1,
    boundedWidth - EXPANDED_CONTENT_WIDTH_OFFSET,
  );
  const moreCount = messages.length - visibleMessages.length;
  const availableRows = calculateAvailableRows(panelHeight);

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
    moreCount,
    showMoreIndicator: moreCount > 0 && visibleMessages.length < availableRows,
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

function QueuedMessagesPanelShell({
  width,
  panelHeight,
  children,
}: {
  width: number;
  panelHeight: number;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={panelHeight}
      overflow="hidden"
      borderStyle="single"
      borderColor={SemanticColors.text.accent}
      borderTop={panelHeight > 1}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={width > 2 ? 1 : 0}
    >
      {children}
    </Box>
  );
}

function CollapsedQueuedMessagesPanel({
  view,
}: {
  view: Extract<QueuedMessagesPanelView, { kind: 'collapsed' }>;
}) {
  return (
    <QueuedMessagesPanelShell width={view.width} panelHeight={view.panelHeight}>
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
        <Text color={SemanticColors.text.secondary}>
          {' '}
          • {QUEUED_MESSAGES_KEY_HINT} to expand
        </Text>
      </Box>
    </QueuedMessagesPanelShell>
  );
}

function ExpandedQueuedMessagesPanel({
  view,
}: {
  view: Extract<QueuedMessagesPanelView, { kind: 'expanded' }>;
}) {
  return (
    <QueuedMessagesPanelShell width={view.width} panelHeight={view.panelHeight}>
      <Box minHeight={1} marginBottom={0}>
        <Text color={SemanticColors.text.accent} bold>
          {view.heading}
        </Text>
        <Text color={SemanticColors.text.secondary}>
          {' '}
          • {QUEUED_MESSAGES_KEY_HINT} to minimize
        </Text>
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
      {view.showMoreIndicator && (
        <Box flexDirection="row" minHeight={1}>
          <Text color={SemanticColors.text.secondary}>
            ▼ +{view.moreCount} more
          </Text>
        </Box>
      )}
    </QueuedMessagesPanelShell>
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
