/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';
import type {
  ModelInfo,
  ModelsLoadStatus,
} from '../../hooks/useWelcomeOnboarding.js';

interface ModelSelectStepProps {
  provider: string;
  models: ModelInfo[];
  modelsLoadStatus: ModelsLoadStatus;
  onSelect: (modelId: string) => void;
  onBack: () => void;
  isFocused?: boolean;
}

export const ModelSelectStep: React.FC<ModelSelectStepProps> = ({
  provider,
  models,
  modelsLoadStatus,
  onSelect,
  onBack,
  isFocused = true,
}) => {
  const providerDisplay = provider.charAt(0).toUpperCase() + provider.slice(1);

  const options: Array<RadioSelectItem<string>> = useMemo(() => {
    const modelOptions = models.map((model) => ({
      label: model.name,
      value: model.id,
      key: model.id,
    }));

    // Add back option
    modelOptions.push({
      label: '← Back to provider selection',
      value: '__back__',
      key: '__back__',
    });

    return modelOptions;
  }, [models]);

  const handleSelect = useCallback(
    (value: string) => {
      if (value === '__back__') {
        onBack();
      } else {
        onSelect(value);
      }
    },
    [onBack, onSelect],
  );

  // Handle Escape to go back (especially useful in error/empty states)
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onBack();
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 2 of 5: Choose Your Model
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Foreground}>
          Select a model for {providerDisplay}:
        </Text>
      </Box>

      {modelsLoadStatus === 'loading' && (
        <Box marginBottom={1}>
          <Text color={Colors.Gray}>Loading models...</Text>
        </Box>
      )}

      {modelsLoadStatus === 'error' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.AccentRed}>Failed to load models.</Text>
          <Text color={Colors.Gray}>Press Esc to go back and try again.</Text>
        </Box>
      )}

      {modelsLoadStatus === 'success' && models.length > 0 && (
        <RadioButtonSelect
          items={options}
          onSelect={handleSelect}
          isFocused={isFocused}
          maxItemsToShow={10}
        />
      )}

      {modelsLoadStatus === 'success' && models.length === 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={Colors.AccentYellow}>
            No models available for this provider.
          </Text>
          <Text color={Colors.Gray}>
            Press Esc to go back and select a different provider.
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          {modelsLoadStatus === 'success' && models.length > 0
            ? 'Use ↑↓ to navigate, Enter to select'
            : 'Press Esc to go back'}
        </Text>
      </Box>
    </Box>
  );
};
