/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';

interface SkipExitStepProps {
  onDismiss: () => void;
  isFocused?: boolean;
}

export const SkipExitStep: React.FC<SkipExitStepProps> = ({
  onDismiss,
  isFocused = true,
}) => {
  useKeypress(
    (key) => {
      if (key.name === 'return') {
        onDismiss();
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Setup skipped
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.Foreground}>To configure llxprt manually:</Text>
        <Box />
        <Text color={Colors.Foreground}>
          • Use <Text color={Colors.AccentCyan}>/auth &lt;provider&gt;</Text> to
          set up authentication
        </Text>
        <Text color={Colors.Foreground}>
          • Use <Text color={Colors.AccentCyan}>/provider</Text> to select your
          AI provider
        </Text>
        <Text color={Colors.Foreground}>
          • Type <Text color={Colors.AccentCyan}>/help</Text> for more commands
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Enter to continue...</Text>
      </Box>
    </Box>
  );
};
