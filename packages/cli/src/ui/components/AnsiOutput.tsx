/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text } from 'ink';
import type {
  AnsiLine,
  AnsiOutput,
  AnsiToken,
} from '@vybestack/llxprt-code-core';

const DEFAULT_HEIGHT = 24;

/**
 * Props for the AnsiOutputText component.
 */
interface AnsiOutputProps {
  /** The structured ANSI output data to render. */
  data: AnsiOutput;
  /** The available height in the terminal for rendering. Used to calculate how many lines to show. */
  availableTerminalHeight?: number;
}

/**
 * Renders ANSI-formatted text using Ink components.
 * It maps the structured `AnsiOutput` data (lines and tokens) to `Text` components with appropriate styling.
 */
export const AnsiOutputText: React.FC<AnsiOutputProps> = ({
  data,
  availableTerminalHeight,
}) => {
  const lastLines = data.slice(
    -(availableTerminalHeight && availableTerminalHeight > 0
      ? availableTerminalHeight
      : DEFAULT_HEIGHT),
  );
  return lastLines.map((line: AnsiLine, lineIndex: number) => (
    <Text key={lineIndex}>
      {line.length > 0
        ? line.map((token: AnsiToken, tokenIndex: number) => (
            <Text
              key={tokenIndex}
              color={token.inverse ? token.bg : token.fg}
              backgroundColor={token.inverse ? token.fg : token.bg}
              dimColor={token.dim}
              bold={token.bold}
              italic={token.italic}
              underline={token.underline}
            >
              {token.text}
            </Text>
          ))
        : ''}
    </Text>
  ));
};
