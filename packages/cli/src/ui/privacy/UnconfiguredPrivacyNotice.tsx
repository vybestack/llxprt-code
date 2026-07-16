/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { Box, Newline, Text } from 'ink';
import { Colors } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface UnconfiguredPrivacyNoticeProps {
  onExit: () => void;
}

/**
 * Neutral privacy notice shown when no provider is configured.
 * Does NOT assume Gemini — the user has not yet chosen a provider, so
 * provider-specific terms do not apply.
 */
export const UnconfiguredPrivacyNotice = ({
  onExit,
}: UnconfiguredPrivacyNoticeProps) => {
  useKeypress(
    useCallback(
      (key: { name?: string }) => {
        if (key.name === 'escape') {
          onExit();
        }
      },
      [onExit],
    ),
    { isActive: true },
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={Colors.AccentPurple}>
        LLxprt Code Privacy Notice
      </Text>
      <Newline />
      <Text color={Colors.Foreground}>
        LLxprt Code does{' '}
        <Text bold color={Colors.Foreground}>
          NOT
        </Text>{' '}
        collect any telemetry or usage data.
      </Text>
      <Newline />
      <Text color={Colors.AccentYellow}>No provider is configured.</Text>
      <Text color={Colors.Foreground}>
        Run{' '}
        <Text bold color={Colors.AccentCyan}>
          /setup
        </Text>{' '}
        to choose a hosted provider, configure a local model, set up a custom
        compatible endpoint, or select an existing profile.
      </Text>
      <Newline />
      <Text color={Colors.Foreground}>
        Once a provider is configured, its specific terms of service and privacy
        policy will apply to your data.
      </Text>
      <Newline />
      <Text color={Colors.Gray}>
        For full provider information, see:
        https://github.com/vybestack/llxprt-code/blob/main/docs/tos-privacy.md
      </Text>
      <Newline />
      <Text color={Colors.Gray}>Press Esc to exit.</Text>
    </Box>
  );
};
