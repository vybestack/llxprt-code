/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { useTerminalStore } from '../../stores/terminal/TerminalContext.js';
import { useStoreSelector } from '../../stores/useStoreSelector.js';
import { useResolvedWorkspaceDirectories } from '../../hooks/useResolvedWorkspaceDirectories.js';

interface AiMessageContentProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  workspaceDirectories?: readonly string[];
}

/*
 * AI message content is a semi-hacked component. The intention is to represent a partial
 * of AiMessage and is only used when a response gets too long. In that instance messages
 * are split into multiple AiMessageContent's to enable the root <Static> component in
 * App.tsx to be as performant as humanly possible.
 */
export const AiMessageContent: React.FC<AiMessageContentProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
  workspaceDirectories,
}) => {
  const { store } = useTerminalStore();
  const renderMarkdown = useStoreSelector(store, (s) => s.renderMarkdown);
  const resolvedWorkspaceDirectories =
    useResolvedWorkspaceDirectories(workspaceDirectories);

  const originalPrefix = '✦ ';
  const prefixWidth = originalPrefix.length;

  return (
    <Box flexDirection="column" paddingLeft={prefixWidth}>
      <MarkdownDisplay
        text={text}
        isPending={isPending}
        availableTerminalHeight={availableTerminalHeight}
        terminalWidth={terminalWidth}
        renderMarkdown={renderMarkdown}
        workspaceDirectories={resolvedWorkspaceDirectories}
      />
    </Box>
  );
};
