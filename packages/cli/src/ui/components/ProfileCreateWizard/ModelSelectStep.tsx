/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { TextInput } from './TextInput.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { PROVIDER_OPTIONS } from './constants.js';
import { getStepPosition } from './utils.js';
import type { WizardState } from './types.js';
import { useRuntimeApi } from '../../contexts/RuntimeContext.js';
import type { HydratedModel } from '@vybestack/llxprt-code-core';

interface ModelSelectStepProps {
  state: WizardState;
  onUpdateModel: (model: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export const ModelSelectStep: React.FC<ModelSelectStepProps> = ({
  state,
  onUpdateModel,
  onContinue,
  onBack,
  onCancel: _onCancel,
}) => {
  const [focusedComponent, setFocusedComponent] = useState<'select' | 'input'>(
    'select',
  );
  const [customModelInput, setCustomModelInput] = useState('');

  // Handle Escape key to go back
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'input') {
          // Go back to select from custom input
          setFocusedComponent('select');
        } else {
          // Go back to previous step
          onBack();
        }
      }
    },
    { isActive: true },
  );

  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        // User selected "Enter custom model name"
        setFocusedComponent('input');
      } else if (value === '__back__') {
        // User selected "Back"
        onBack();
      } else {
        onUpdateModel(value);
        // Automatically proceed to next step
        onContinue();
      }
    },
    [onUpdateModel, onContinue, onBack],
  );

  const handleCustomModelSubmit = useCallback(() => {
    if (customModelInput.trim()) {
      onUpdateModel(customModelInput.trim());
      // Automatically proceed to next step
      onContinue();
    }
  }, [customModelInput, onUpdateModel, onContinue]);

  // Fetch models from provider via runtime API (hydrated with models.dev data)
  const runtime = useRuntimeApi();
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadModels = async () => {
      if (!state.config.provider) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const hydratedModels: HydratedModel[] =
          await runtime.listAvailableModels(state.config.provider);
        // Filter out deprecated models and extract IDs
        const modelIds = hydratedModels
          .filter((m) => m.metadata?.status !== 'deprecated')
          .map((m) => m.id);
        setModels(modelIds);
      } catch {
        // If fetching fails, allow manual entry
        setModels([]);
      }
      setIsLoading(false);
    };
    loadModels();
  }, [runtime, state.config.provider]);

  const hasKnownModels = models.length > 0;

  // Still need providerOption for label display
  const providerOption = PROVIDER_OPTIONS.find(
    (p) => p.value === state.config.provider,
  );

  // Build model list with "custom" option if provider has known models
  const modelItems = hasKnownModels
    ? [
        ...models.map((m, idx) => ({
          label: idx === 0 ? `${m} (Recommended)` : m,
          value: m,
          key: m,
        })),
        {
          label: 'Enter custom model name...',
          value: '__custom__',
          key: '__custom__',
        },
        {
          label: '← Back',
          value: '__back__',
          key: '__back__',
        },
      ]
    : [];

  const selectedModel = state.config.model || undefined;
  const initialIndex =
    selectedModel && hasKnownModels
      ? models.findIndex((m) => m === selectedModel)
      : undefined;

  const { current, total } = getStepPosition(state);

  // Show loading state while fetching models
  if (isLoading) {
    return (
      <Box flexDirection="column">
        <Text bold color={Colors.AccentCyan}>
          Create New Profile - Step {current} of {total}
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Gray}>Loading models...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentCyan}>
        Create New Profile - Step {current} of {total}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>
        {focusedComponent === 'input' ? 'Enter Model Name:' : 'Select Model:'}
      </Text>
      <Text color={Colors.Gray}>
        {focusedComponent === 'input'
          ? "Enter the model name exactly as it appears in your provider's documentation"
          : `Choose the AI model for ${providerOption?.label || state.config.provider}`}
      </Text>
      <Text color={Colors.Foreground}> </Text>

      {focusedComponent === 'select' && hasKnownModels && (
        <>
          <RadioButtonSelect
            items={modelItems}
            initialIndex={initialIndex}
            onSelect={handleModelSelect}
            isFocused={true}
          />
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>Esc Back</Text>
        </>
      )}

      {focusedComponent === 'select' && !hasKnownModels && (
        <>
          <Text color={Colors.Gray}>
            This provider doesn&apos;t have a predefined model list.
          </Text>
          <Text color={Colors.Gray}>Enter the model name manually:</Text>
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Foreground}>Model name:</Text>
          <TextInput
            value={customModelInput}
            onChange={setCustomModelInput}
            onSubmit={handleCustomModelSubmit}
            isFocused={true}
            placeholder="model-name"
          />
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            ← → Move cursor Enter Continue Esc Back
          </Text>
        </>
      )}

      {focusedComponent === 'input' && (
        <>
          <Text color={Colors.Foreground}>Model name:</Text>
          <TextInput
            value={customModelInput}
            onChange={setCustomModelInput}
            onSubmit={handleCustomModelSubmit}
            isFocused={true}
            placeholder="model-name"
          />
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            For Ollama: Run &apos;ollama list&apos; to see available models
          </Text>
          <Text color={Colors.Gray}>
            For custom providers: Check provider documentation
          </Text>
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            ← → Move cursor Enter Continue Esc Back to list
          </Text>
        </>
      )}
    </Box>
  );
};
