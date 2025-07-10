/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { Colors } from '../../colors.js';

interface GeminiMessageProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  model?: string;
}

export const GeminiMessage: React.FC<GeminiMessageProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
  model,
}) => {
  const prefix = '✦ ';
  const prefixWidth = prefix.length;

  return (
    <Box flexDirection="column">
      {model && (
        <Box marginBottom={0}>
          <Text color={Colors.Gray} dimColor>
            {model}
          </Text>
        </Box>
      )}
      <Box flexDirection="row">
        <Box width={prefixWidth}>
          <Text color={Colors.AccentPurple}>{prefix}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <MarkdownDisplay
            text={text}
            isPending={isPending}
            availableTerminalHeight={availableTerminalHeight}
            terminalWidth={terminalWidth}
          />
        </Box>
      </Box>
    </Box>
  );
};
