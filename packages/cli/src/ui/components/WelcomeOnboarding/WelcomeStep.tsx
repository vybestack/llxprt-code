/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';

export type WelcomeChoice = 'setup' | 'skip';

interface WelcomeStepProps {
  onSelect: (choice: WelcomeChoice) => void;
  isFocused?: boolean;
}

export const WelcomeStep: React.FC<WelcomeStepProps> = ({
  onSelect,
  isFocused = true,
}) => {
  const options: Array<RadioSelectItem<WelcomeChoice>> = [
    {
      label: 'Set up now (recommended)',
      value: 'setup',
      key: 'setup',
    },
    {
      label: "Skip setup (I know what I'm doing)",
      value: 'skip',
      key: 'skip',
    },
  ];

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Welcome to llxprt!
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Foreground}>
          {"Let's get you set up in just a few steps."}
        </Text>
        <Text color={Colors.Foreground}>
          {"You'll choose an AI provider and configure authentication"}
        </Text>
        <Text color={Colors.Foreground}>so llxprt can work its magic.</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          What would you like to do?
        </Text>
      </Box>

      <RadioButtonSelect
        items={options}
        onSelect={onSelect}
        isFocused={isFocused}
      />

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Use ↑↓ to navigate, Enter to select, Esc to skip
        </Text>
      </Box>
    </Box>
  );
};
