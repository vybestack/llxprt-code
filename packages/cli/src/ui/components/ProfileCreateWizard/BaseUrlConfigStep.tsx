/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { TextInput } from './TextInput.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { PROVIDER_OPTIONS } from './constants.js';
import { validateBaseUrl } from './validation.js';
import { getStepPosition } from './utils.js';
import type { WizardState } from './types.js';

interface BaseUrlConfigStepProps {
  state: WizardState;
  onUpdateBaseUrl: (baseUrl: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

export const BaseUrlConfigStep: React.FC<BaseUrlConfigStepProps> = ({
  state,
  onUpdateBaseUrl,
  onContinue,
  onBack,
}) => {
  // Handle Escape key to go back
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onBack();
      }
    },
    { isActive: true },
  );

  const providerOption = PROVIDER_OPTIONS.find(
    (p) => p.value === state.config.provider,
  );
  const defaultBaseUrl = providerOption?.defaultBaseUrl || '';

  // Initialize with default URL if available and not already set
  const [inputValue, setInputValue] = useState(
    state.config.baseUrl || defaultBaseUrl,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      const validation = validateBaseUrl(value);
      setValidationError(validation.valid ? null : validation.error || null);
      if (validation.valid) {
        onUpdateBaseUrl(value);
      }
    },
    [onUpdateBaseUrl],
  );

  const handleInputSubmit = useCallback(() => {
    const validation = validateBaseUrl(inputValue);
    if (validation.valid) {
      onContinue();
    } else {
      setValidationError(validation.error || 'Invalid URL');
    }
  }, [inputValue, onContinue]);

  const isCustomProvider = state.config.provider === 'custom';
  const helpText = isCustomProvider
    ? 'Enter the API endpoint for your custom provider:'
    : `${providerOption?.label || 'This provider'} typically runs on the default port. Edit if using a different configuration.`;

  const { current, total } = getStepPosition(state);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentCyan}>
        Create New Profile - Step {current} of {total}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>Configure Base URL:</Text>
      <Text color={Colors.Gray}>{helpText}</Text>
      <Text color={Colors.Foreground}> </Text>

      {isCustomProvider && (
        <>
          <Text color={Colors.Gray}>Examples:</Text>
          <Text color={Colors.Gray}> • https://api.x.ai/v1/</Text>
          <Text color={Colors.Gray}> • https://openrouter.ai/api/v1/</Text>
          <Text color={Colors.Gray}>
            • https://api.fireworks.ai/inference/v1/
          </Text>
          <Text color={Colors.Foreground}> </Text>
        </>
      )}

      <Text color={Colors.Foreground}>Base URL:</Text>
      <TextInput
        value={inputValue}
        onChange={handleInputChange}
        onSubmit={handleInputSubmit}
        isFocused={true}
        placeholder="https://..."
      />
      {validationError && (
        <Text color={Colors.AccentRed}>✗ {validationError}</Text>
      )}
      {!validationError && inputValue && (
        <Text color={Colors.AccentGreen}>✓ Valid</Text>
      )}
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Gray}>← → Move cursor Enter Continue Esc Back</Text>
    </Box>
  );
};
