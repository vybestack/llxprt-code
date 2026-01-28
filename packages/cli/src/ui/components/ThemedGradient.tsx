/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import Gradient from 'ink-gradient';
import { theme } from '../semantic-colors.js';

interface ThemedGradientProps {
  children: React.ReactNode;
  colors?: string[];
}

/**
 * ThemedGradient component that safely handles gradient rendering
 * in terminals without full truecolor support (e.g., tmux without proper settings).
 *
 * Behavior:
 * - If gradient has 2+ colors: render with Gradient
 * - If gradient has 1 color: render with single color
 * - If gradient is undefined/empty: render plain text with default color
 */
export const ThemedGradient: React.FC<ThemedGradientProps> = ({
  children,
  colors,
}) => {
  const gradient = colors ?? theme.ui.gradient;

  if (gradient && gradient.length >= 2) {
    return (
      <Gradient colors={gradient}>
        <Text color={theme.text.primary}>{children}</Text>
      </Gradient>
    );
  }

  if (gradient && gradient.length === 1) {
    return <Text color={gradient[0]}>{children}</Text>;
  }

  return <Text color={theme.text.primary}>{children}</Text>;
};
