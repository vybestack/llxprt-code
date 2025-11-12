/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { useSettings } from '../hooks/useSettings.js';

interface WelcomeScreenProps {
  onComplete: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
  const { userSettings, isLoading } = useSettings();

  // Check if any provider is already configured
  useEffect(() => {
    if (!isLoading && userSettings) {
      const hasProvider =
        Object.keys(userSettings.providerApiKeys || {}).length > 0;
      if (hasProvider) {
        onComplete();
      }
    }
  }, [userSettings, isLoading, onComplete]);

  if (isLoading) {
    return (
      <Box
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        height={10}
      >
        <Text color={Colors.Gray}>Loading settings...</Text>
      </Box>
    );
  }

  // If we get here but the component hasn't been unmounted, show the welcome screen
  if (
    !isLoading &&
    userSettings?.providerApiKeys &&
    Object.keys(userSettings.providerApiKeys).length > 0
  ) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentGreen}>
          Welcome to LLxprt Code!
        </Text>
        <Text color={Colors.Gray}>Get started in a few simple steps</Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Text color={Colors.Foreground}>
          Choose how you&apos;d like to configure your AI provider:
        </Text>

        <Box flexDirection="column" gap={1} marginTop={1}>
          <Box flexDirection="column">
            <Text color={Colors.AccentCyan}>[G] Authenticate with Google</Text>
            <Text color={Colors.Gray} dimColor>
              Quick setup with Google Gemini models
            </Text>
          </Box>

          <Box flexDirection="column">
            <Text color={Colors.AccentCyan}>
              [C] Configure Another Provider
            </Text>
            <Text color={Colors.Gray} dimColor>
              Set up OpenAI, Anthropic, or other compatible providers
            </Text>
          </Box>

          <Box flexDirection="column">
            <Text color={Colors.AccentCyan}>[D] View Documentation</Text>
            <Text color={Colors.Gray} dimColor>
              Learn about features and configuration options
            </Text>
          </Box>

          <Box flexDirection="column">
            <Text color={Colors.AccentCyan}>[T] Browse Tutorials</Text>
            <Text color={Colors.Gray} dimColor>
              Get started with step-by-step guides
            </Text>
          </Box>
        </Box>

        <Box marginTop={2}>
          <Text color={Colors.AccentYellow} dimColor>
            Press the highlighted key or click to select an option
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export { WelcomeScreen };
