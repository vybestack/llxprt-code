/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { type Config } from '@vybestack/llxprt-code-core';

interface TipsProps {
  config: Config;
}

export const Tips: React.FC<TipsProps> = ({ config }) => {
  const contextFileCount = config.getContextFileCount();
  return (
    <Box flexDirection="column">
      <Text color={Colors.Foreground}>Tips for getting started:</Text>
      <Text color={Colors.Foreground}>
        1. Ask questions, edit files, or run commands.
      </Text>
      <Text color={Colors.Foreground}>
        2. Be specific for the best results.
      </Text>
      {contextFileCount === 0 && (
        <Text color={Colors.Foreground}>
          3. Create{' '}
          <Text bold color={Colors.AccentPurple}>
            AGENT.md
          </Text>{' '}
          files to customize your interactions with the agent.
        </Text>
      )}
      <Text color={Colors.Foreground}>
        {contextFileCount === 0 ? '4.' : '3.'}{' '}
        <Text bold color={Colors.AccentPurple}>
          /help
        </Text>{' '}
        for more information.
      </Text>
    </Box>
  );
};
