/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { PROVIDER_OPTIONS } from './constants.js';
import { getStepPosition } from './utils.js';
import type { WizardState } from './types.js';

const logger = new DebugLogger('llxprt:ui:profilewizard');

interface ProviderSelectStepProps {
  state: WizardState;
  onUpdateProvider: (provider: string) => void;
  onCancel: () => void;
  availableProviders?: string[];
}

export const ProviderSelectStep: React.FC<ProviderSelectStepProps> = ({
  state,
  onUpdateProvider,
  onCancel,
  availableProviders,
}) => {
  // Handle Escape key to cancel
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onCancel();
      }
    },
    { isActive: true },
  );

  const handleProviderSelect = useCallback(
    (value: string) => {
      // Debug: show provider value
      logger.debug(() => `Provider selected: "${value}"`);
      // Update provider - navigation is handled by parent based on new value
      onUpdateProvider(value);
    },
    [onUpdateProvider],
  );

  // Use available providers from runtime if provided, otherwise fall back to static list
  const providers = availableProviders || PROVIDER_OPTIONS.map((p) => p.value);

  // Build items list with labels from PROVIDER_OPTIONS where available
  const providerItems = providers.map((providerValue) => {
    const option = PROVIDER_OPTIONS.find((p) => p.value === providerValue);
    return {
      label: option?.label || providerValue,
      value: providerValue,
      key: providerValue,
    };
  });

  const selectedProvider = state.config.provider || undefined;
  const initialIndex = selectedProvider
    ? providerItems.findIndex((p) => p.value === selectedProvider)
    : undefined;

  const { current, total } = getStepPosition(state);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentCyan}>
        Create New Profile - Step {current} of {total}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>Select AI Provider:</Text>
      <Text color={Colors.Gray}>
        Choose the AI provider you want to use for this profile.
      </Text>
      <Text color={Colors.Foreground}> </Text>

      <RadioButtonSelect
        items={providerItems}
        initialIndex={initialIndex}
        onSelect={handleProviderSelect}
        isFocused={true}
      />
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Gray}>Esc Cancel</Text>
    </Box>
  );
};
