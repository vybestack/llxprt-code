/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { TextInput } from './TextInput.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { PARAMETER_DEFAULTS } from './constants.js';
import { PARAM_VALIDATORS } from './validation.js';
import { getStepPosition } from './utils.js';
import type { WizardState, AdvancedParams } from './types.js';

const getParameterDefaults = (provider: string | null): AdvancedParams => {
  if (provider === null || provider === '') {
    return PARAMETER_DEFAULTS.anthropic;
  }

  if (Object.prototype.hasOwnProperty.call(PARAMETER_DEFAULTS, provider)) {
    return PARAMETER_DEFAULTS[provider];
  }

  return PARAMETER_DEFAULTS.anthropic;
};

const FIELD_LABELS = {
  temperature: 'Temperature (0.0-2.0)',
  maxTokens: 'Max Tokens (positive integer)',
  contextLimit: 'Context Limit (positive integer)',
} as const;

const FIELD_HELP = {
  temperature:
    'Controls randomness. Lower = more focused, Higher = more creative',
  maxTokens: 'Maximum tokens to generate in responses',
  contextLimit: 'Maximum context window size',
} as const;

type ParamField = 'temperature' | 'maxTokens' | 'contextLimit';

const advanceField = (
  currentField: ParamField,
  customParams: AdvancedParams,
  setCurrentField: (f: ParamField) => void,
  onUpdateParams: (params: AdvancedParams | undefined) => void,
  onContinue: () => void,
) => {
  if (currentField === 'temperature') {
    setCurrentField('maxTokens');
  } else if (currentField === 'maxTokens') {
    setCurrentField('contextLimit');
  } else {
    onUpdateParams(customParams);
    onContinue();
  }
};

const buildParamOptions = (providerDefaults: AdvancedParams) => [
  {
    label: `Use recommended defaults (temp: ${providerDefaults.temperature}, max tokens: ${providerDefaults.maxTokens})`,
    value: 'defaults',
    key: 'defaults',
  },
  {
    label: 'Configure custom parameters',
    value: 'custom',
    key: 'custom',
  },
  {
    label: 'Skip (use system defaults)',
    value: 'skip',
    key: 'skip',
  },
];

const CustomFieldInput: React.FC<{
  currentField: ParamField;
  fieldInput: string;
  validationError: string | null;
  handleFieldChange: (value: string) => void;
  handleFieldSubmit: () => void;
}> = ({
  currentField,
  fieldInput,
  validationError,
  handleFieldChange,
  handleFieldSubmit,
}) => (
  <>
    <Text color={Colors.Foreground}>{FIELD_LABELS[currentField]}:</Text>
    <Text color={Colors.Gray}>{FIELD_HELP[currentField]}</Text>
    <Text color={Colors.Foreground}> </Text>
    <TextInput
      value={fieldInput}
      onChange={handleFieldChange}
      onSubmit={handleFieldSubmit}
      isFocused={true}
      placeholder={currentField === 'temperature' ? '1.0' : '4096'}
    />
    {validationError && (
      <Text color={Colors.AccentRed}>✗ {validationError}</Text>
    )}
    {!validationError && fieldInput && (
      <Text color={Colors.AccentGreen}>✓ Valid</Text>
    )}
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>
      Press Enter to set value or leave empty to skip
    </Text>
    <Text color={Colors.Gray}>
      Progress:{' '}
      {currentField === 'temperature'
        ? '1'
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          currentField === 'maxTokens'
          ? '2'
          : '3'}
      /3
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>Enter Continue Esc Back to menu</Text>
  </>
);

const ParamSelectView: React.FC<{
  paramOptions: Array<{ label: string; value: string; key: string }>;
  handleParamSelect: (value: string) => void;
}> = ({ paramOptions, handleParamSelect }) => (
  <>
    <RadioButtonSelect
      items={paramOptions}
      onSelect={handleParamSelect}
      isFocused={true}
    />
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>Esc Cancel</Text>
  </>
);

const useEscapeHandler = (
  focusedComponent: 'select' | 'custom',
  setFocusedComponent: (v: 'select' | 'custom') => void,
  setFieldInput: (v: string) => void,
  setValidationError: (v: string | null) => void,
  onCancel: () => void,
) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'custom') {
          setFocusedComponent('select');
          setFieldInput('');
          setValidationError(null);
        } else {
          onCancel();
        }
      }
    },
    { isActive: true },
  );
};

const useFieldSubmitHandler = (
  fieldInput: string,
  currentField: ParamField,
  customParams: AdvancedParams,
  onUpdateParams: (params: AdvancedParams | undefined) => void,
  onContinue: () => void,
  setFieldInput: (v: string) => void,
  setCurrentField: (f: ParamField) => void,
  setCustomParams: (p: AdvancedParams) => void,
  setValidationError: (v: string | null) => void,
) =>
  useCallback(() => {
    const numValue =
      currentField === 'temperature'
        ? Number.parseFloat(fieldInput)
        : Number.parseInt(fieldInput, 10);

    if (!fieldInput.trim()) {
      setFieldInput('');
      setValidationError(null);
      advanceField(
        currentField,
        customParams,
        setCurrentField,
        onUpdateParams,
        onContinue,
      );
      return;
    }

    if (Number.isNaN(numValue)) {
      setValidationError('Must be a valid number');
      return;
    }

    const validation = PARAM_VALIDATORS[currentField](numValue);
    if (!validation.valid) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string error should use default message
      setValidationError(validation.error || 'Invalid value');
      return;
    }

    const updated = { ...customParams, [currentField]: numValue };
    setCustomParams(updated);
    setFieldInput('');
    setValidationError(null);
    advanceField(
      currentField,
      updated,
      setCurrentField,
      onUpdateParams,
      onContinue,
    );
  }, [
    fieldInput,
    currentField,
    customParams,
    onUpdateParams,
    onContinue,
    setFieldInput,
    setCurrentField,
    setCustomParams,
    setValidationError,
  ]);

const AdvancedParamsHeader: React.FC<{ current: number; total: number }> = ({
  current,
  total,
}) => (
  <>
    <Text bold color={Colors.AccentCyan}>
      Create New Profile - Step {current} of {total}
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Foreground}>Advanced Parameters:</Text>
    <Text color={Colors.Gray}>
      Configure temperature, max tokens, and context limits (optional)
    </Text>
    <Text color={Colors.Foreground}> </Text>
  </>
);

interface AdvancedParamsStepProps {
  state: WizardState;
  onUpdateParams: (params: AdvancedParams | undefined) => void;
  onContinue: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export const AdvancedParamsStep: React.FC<AdvancedParamsStepProps> = ({
  state,
  onUpdateParams,
  onContinue,
  onBack: _onBack,
  onCancel,
}) => {
  const [focusedComponent, setFocusedComponent] = useState<'select' | 'custom'>(
    'select',
  );
  const [customParams, setCustomParams] = useState<AdvancedParams>({
    temperature: undefined,
    maxTokens: undefined,
    contextLimit: undefined,
  });
  const [currentField, setCurrentField] = useState<ParamField>('temperature');
  const [fieldInput, setFieldInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEscapeHandler(
    focusedComponent,
    setFocusedComponent,
    setFieldInput,
    setValidationError,
    onCancel,
  );

  const handleParamSelect = useCallback(
    (value: string) => {
      if (value === 'defaults') {
        const defaults = getParameterDefaults(state.config.provider);
        onUpdateParams(defaults);
        onContinue();
      } else if (value === 'skip') {
        onUpdateParams(undefined);
        onContinue();
      } else if (value === 'custom') {
        setFocusedComponent('custom');
        setCurrentField('temperature');
      }
    },
    [state.config.provider, onUpdateParams, onContinue],
  );

  const handleFieldChange = useCallback((value: string) => {
    setFieldInput(value);
    setValidationError(null);
  }, []);

  const handleFieldSubmit = useFieldSubmitHandler(
    fieldInput,
    currentField,
    customParams,
    onUpdateParams,
    onContinue,
    setFieldInput,
    setCurrentField,
    setCustomParams,
    setValidationError,
  );

  const providerDefaults = getParameterDefaults(state.config.provider);
  const paramOptions = buildParamOptions(providerDefaults);
  const { current, total } = getStepPosition(state);

  return (
    <Box flexDirection="column">
      <AdvancedParamsHeader current={current} total={total} />
      {focusedComponent === 'select' && (
        <ParamSelectView
          paramOptions={paramOptions}
          handleParamSelect={handleParamSelect}
        />
      )}
      {focusedComponent === 'custom' && (
        <CustomFieldInput
          currentField={currentField}
          fieldInput={fieldInput}
          validationError={validationError}
          handleFieldChange={handleFieldChange}
          handleFieldSubmit={handleFieldSubmit}
        />
      )}
    </Box>
  );
};
