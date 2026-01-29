/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';

interface InfoMessageProps {
  text: string;
  icon?: string; // Custom prefix (default: 'ℹ ')
  color?: string; // Custom color (default: theme.status.warning)
}

export const InfoMessage: React.FC<InfoMessageProps> = ({
  text,
  icon,
  color,
}) => {
  color ??= theme.status.warning;
  const prefix = icon ?? 'ℹ ';
  const prefixWidth = prefix.length;

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box width={prefixWidth}>
        <Text color={color}>{prefix}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {text.split('\n').map((line, index) => (
          <Text wrap="wrap" key={index} color={color}>
            <RenderInline text={line} defaultColor={color} />
          </Text>
        ))}
      </Box>
    </Box>
  );
};
