/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
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

const buildModelItems = (models: string[]) => [
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
];

const NoModelsManualInput: React.FC<{
  customModelInput: string;
  onCustomModelChange: (value: string) => void;
  handleCustomModelSubmit: () => void;
}> = ({ customModelInput, onCustomModelChange, handleCustomModelSubmit }) => (
  <>
    <Text color={Colors.Gray}>
      This provider doesn&apos;t have a predefined model list.
    </Text>
    <Text color={Colors.Gray}>Enter the model name manually:</Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Foreground}>Model name:</Text>
    <TextInput
      value={customModelInput}
      onChange={onCustomModelChange}
      onSubmit={handleCustomModelSubmit}
      isFocused={true}
      placeholder="model-name"
    />
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>← → Move cursor Enter Continue Esc Back</Text>
  </>
);

const CustomModelInput: React.FC<{
  customModelInput: string;
  onCustomModelChange: (value: string) => void;
  handleCustomModelSubmit: () => void;
}> = ({ customModelInput, onCustomModelChange, handleCustomModelSubmit }) => (
  <>
    <Text color={Colors.Foreground}>Model name:</Text>
    <TextInput
      value={customModelInput}
      onChange={onCustomModelChange}
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
);

const useProviderModels = (provider: string | null) => {
  const runtime = useRuntimeApi();
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadModels = async () => {
      if (!provider) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const hydratedModels: HydratedModel[] =
          await runtime.listAvailableModels(provider);
        const modelIds = hydratedModels
          .filter((m) => m.metadata?.status !== 'deprecated')
          .map((m) => m.id);
        setModels(modelIds);
      } catch {
        setModels([]);
      }
      setIsLoading(false);
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadModels();
  }, [runtime, provider]);

  return { models, isLoading };
};

const LoadingView: React.FC<{ current: number; total: number }> = ({
  current,
  total,
}) => (
  <Box flexDirection="column">
    <Text bold color={Colors.AccentCyan}>
      Create New Profile - Step {current} of {total}
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>Loading models...</Text>
  </Box>
);

const ModelSelectListView: React.FC<{
  modelItems: Array<{ label: string; value: string; key: string }>;
  initialIndex: number | undefined;
  handleModelSelect: (value: string) => void;
}> = ({ modelItems, initialIndex, handleModelSelect }) => (
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
);

const useModelSelectEscape = (
  focusedComponent: 'select' | 'input',
  setFocusedComponent: (v: 'select' | 'input') => void,
  onBack: () => void,
) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'input') {
          setFocusedComponent('select');
        } else {
          onBack();
        }
      }
    },
    { isActive: true },
  );
};

const applyModelSelection = (
  value: string,
  setFocusedComponent: (v: 'select' | 'input') => void,
  onUpdateModel: (model: string) => void,
  onContinue: () => void,
  onBack: () => void,
) => {
  if (value === '__custom__') {
    setFocusedComponent('input');
  } else if (value === '__back__') {
    onBack();
  } else {
    onUpdateModel(value);
    onContinue();
  }
};

const ModelSelectHeaderView: React.FC<{
  focusedComponent: 'select' | 'input';
  providerOption: { label?: string } | undefined;
  provider: string | null;
}> = ({ focusedComponent, providerOption, provider }) => (
  <>
    <Text color={Colors.Foreground}>
      {focusedComponent === 'input' ? 'Enter Model Name:' : 'Select Model:'}
    </Text>
    <Text color={Colors.Gray}>
      {focusedComponent === 'input'
        ? "Enter the model name exactly as it appears in your provider's documentation"
        : `Choose the AI model for ${providerOption?.label ?? provider}`}
    </Text>
  </>
);

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

  useModelSelectEscape(focusedComponent, setFocusedComponent, onBack);

  const handleModelSelect = useCallback(
    (value: string) => {
      applyModelSelection(
        value,
        setFocusedComponent,
        onUpdateModel,
        onContinue,
        onBack,
      );
    },
    [onUpdateModel, onContinue, onBack],
  );

  const handleCustomModelSubmit = useCallback(() => {
    if (customModelInput.trim()) {
      onUpdateModel(customModelInput.trim());
      onContinue();
    }
  }, [customModelInput, onUpdateModel, onContinue]);

  const { models, isLoading } = useProviderModels(state.config.provider);
  const hasKnownModels = models.length > 0;
  const providerOption = PROVIDER_OPTIONS.find(
    (p) => p.value === state.config.provider,
  );
  const modelItems = hasKnownModels ? buildModelItems(models) : [];
  const selectedModel = state.config.model ?? undefined;
  const initialIndex =
    selectedModel && hasKnownModels
      ? models.findIndex((m) => m === selectedModel)
      : undefined;

  const { current, total } = getStepPosition(state);

  if (isLoading) {
    return <LoadingView current={current} total={total} />;
  }

  return (
    <ModelSelectContent
      focusedComponent={focusedComponent}
      hasKnownModels={hasKnownModels}
      modelItems={modelItems}
      initialIndex={initialIndex}
      handleModelSelect={handleModelSelect}
      customModelInput={customModelInput}
      onCustomModelChange={setCustomModelInput}
      handleCustomModelSubmit={handleCustomModelSubmit}
      current={current}
      total={total}
      providerOption={providerOption}
      provider={state.config.provider}
    />
  );
};

const ModelSelectContent: React.FC<{
  focusedComponent: 'select' | 'input';
  hasKnownModels: boolean;
  modelItems: Array<{ label: string; value: string; key: string }>;
  initialIndex: number | undefined;
  handleModelSelect: (value: string) => void;
  customModelInput: string;
  onCustomModelChange: (value: string) => void;
  handleCustomModelSubmit: () => void;
  current: number;
  total: number;
  providerOption: { label?: string } | undefined;
  provider: string | null;
}> = ({
  focusedComponent,
  hasKnownModels,
  modelItems,
  initialIndex,
  handleModelSelect,
  customModelInput,
  onCustomModelChange,
  handleCustomModelSubmit,
  current,
  total,
  providerOption,
  provider,
}) => (
  <Box flexDirection="column">
    <Text bold color={Colors.AccentCyan}>
      Create New Profile - Step {current} of {total}
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <ModelSelectHeaderView
      focusedComponent={focusedComponent}
      providerOption={providerOption}
      provider={provider}
    />
    <Text color={Colors.Foreground}> </Text>
    {focusedComponent === 'select' && hasKnownModels && (
      <ModelSelectListView
        modelItems={modelItems}
        initialIndex={initialIndex}
        handleModelSelect={handleModelSelect}
      />
    )}
    {focusedComponent === 'select' && !hasKnownModels && (
      <NoModelsManualInput
        customModelInput={customModelInput}
        onCustomModelChange={onCustomModelChange}
        handleCustomModelSubmit={handleCustomModelSubmit}
      />
    )}
    {focusedComponent === 'input' && (
      <CustomModelInput
        customModelInput={customModelInput}
        onCustomModelChange={onCustomModelChange}
        handleCustomModelSubmit={handleCustomModelSubmit}
      />
    )}
  </Box>
);
