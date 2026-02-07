/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import type {
  AnsiLine,
  AnsiOutput,
  AnsiToken,
} from '@vybestack/llxprt-code-core';
import { Colors } from '../colors.js';

const DEFAULT_HEIGHT = 24;

interface AnsiOutputProps {
  data: AnsiOutput;
  availableTerminalHeight?: number;
  width: number;
}

export const AnsiOutputText: React.FC<AnsiOutputProps> = ({
  data,
  availableTerminalHeight,
  width,
}) => {
  const linesToShow =
    availableTerminalHeight && availableTerminalHeight > 0
      ? availableTerminalHeight
      : DEFAULT_HEIGHT;

  let cursorLineIndex = -1;
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const line = data[i];
    if (line.some((token) => token.inverse)) {
      cursorLineIndex = i;
      break;
    }
  }

  let lastNonEmpty = -1;
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const line = data[i];
    const lineText = line.map((token) => token.text).join('');
    if (lineText.trim().length > 0) {
      lastNonEmpty = i;
      break;
    }
  }

  const renderEndIndex = Math.max(lastNonEmpty, cursorLineIndex);

  if (data.length === 0) {
    return null;
  }

  const endIndex = renderEndIndex + 1;
  const startIndex = Math.max(0, endIndex - linesToShow);
  const linesToRender = data.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {linesToRender.map((line: AnsiLine, lineIndex: number) => (
        <Box key={lineIndex} width={width} flexShrink={0}>
          {line.length > 0 ? (
            line.map((token: AnsiToken, tokenIndex: number) => (
              <Text
                key={tokenIndex}
                color={
                  token.dim ? Colors.DimComment : token.fg || Colors.Foreground
                }
                backgroundColor={token.bg || undefined}
                inverse={token.inverse}
                bold={token.bold}
                italic={token.italic}
                underline={token.underline}
              >
                {token.text.replace(/\u00a0/g, ' ')}
              </Text>
            ))
          ) : (
            <Text color={Colors.Foreground}> </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};
