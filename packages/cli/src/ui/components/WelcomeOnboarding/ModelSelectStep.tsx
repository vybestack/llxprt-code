/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo, useCallback } from 'react';
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
  onSelect: (modelId: string) => void | Promise<void>;
  onBack: () => void;
  isFocused?: boolean;
}

const ModelSelectHeader: React.FC<{ providerDisplay: string }> = ({
  providerDisplay,
}) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.AccentCyan}>
      Step 2 of 5: Choose Your Model
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Foreground}>Select a model for {providerDisplay}:</Text>
  </Box>
);

const ModelLoadingState: React.FC = () => (
  <Box marginBottom={1}>
    <Text color={Colors.Gray}>Loading models...</Text>
  </Box>
);

const ModelErrorState: React.FC = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={Colors.AccentRed}>Failed to load models.</Text>
    <Text color={Colors.Gray}>Press Esc to go back and try again.</Text>
  </Box>
);

const ModelEmptyState: React.FC = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={Colors.AccentYellow}>
      No models available for this provider.
    </Text>
    <Text color={Colors.Gray}>
      Press Esc to go back and select a different provider.
    </Text>
  </Box>
);

const ModelFooterHint: React.FC<{ showNavHint: boolean }> = ({
  showNavHint,
}) => (
  <Box marginTop={1}>
    <Text color={Colors.Gray}>
      {showNavHint
        ? 'Use ↑↓ to navigate, Enter to select'
        : 'Press Esc to go back'}
    </Text>
  </Box>
);

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
        void onSelect(value);
      }
    },
    [onBack, onSelect],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onBack();
      }
    },
    { isActive: isFocused },
  );

  const showNavHint = modelsLoadStatus === 'success' && models.length > 0;

  return (
    <Box flexDirection="column">
      <ModelSelectHeader providerDisplay={providerDisplay} />
      {modelsLoadStatus === 'loading' && <ModelLoadingState />}
      {modelsLoadStatus === 'error' && <ModelErrorState />}
      {modelsLoadStatus === 'success' && models.length > 0 && (
        <RadioButtonSelect
          items={options}
          onSelect={handleSelect}
          isFocused={isFocused}
          maxItemsToShow={10}
        />
      )}
      {modelsLoadStatus === 'success' && models.length === 0 && (
        <ModelEmptyState />
      )}
      <ModelFooterHint showNavHint={showNavHint} />
    </Box>
  );
};
