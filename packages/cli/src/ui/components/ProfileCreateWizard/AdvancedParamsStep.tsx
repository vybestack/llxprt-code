/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { TextInput } from './TextInput.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { PARAMETER_DEFAULTS } from './constants.js';
import { PARAM_VALIDATORS } from './validation.js';
import { getStepPosition } from './utils.js';
import type { WizardState, AdvancedParams } from './types.js';

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
  const [currentField, setCurrentField] = useState<
    'temperature' | 'maxTokens' | 'contextLimit'
  >('temperature');
  const [fieldInput, setFieldInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Handle Escape key to cancel or go back
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'custom') {
          // Go back to selection menu
          setFocusedComponent('select');
          setFieldInput('');
          setValidationError(null);
        } else {
          // Cancel wizard
          onCancel();
        }
      }
    },
    { isActive: true },
  );

  const handleParamSelect = useCallback(
    (value: string) => {
      if (value === 'defaults') {
        // Use provider defaults
        const defaults =
          PARAMETER_DEFAULTS[state.config.provider || ''] ||
          PARAMETER_DEFAULTS.anthropic;
        onUpdateParams(defaults);
        onContinue();
      } else if (value === 'skip') {
        // Skip params (use system defaults)
        onUpdateParams(undefined);
        onContinue();
      } else if (value === 'custom') {
        // Enter custom configuration mode
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

  const handleFieldSubmit = useCallback(() => {
    const numValue =
      currentField === 'temperature'
        ? Number.parseFloat(fieldInput)
        : Number.parseInt(fieldInput, 10);

    if (!fieldInput.trim()) {
      // Allow skipping individual fields
      setFieldInput('');
      setValidationError(null);

      // Move to next field
      if (currentField === 'temperature') {
        setCurrentField('maxTokens');
      } else if (currentField === 'maxTokens') {
        setCurrentField('contextLimit');
      } else {
        // Done with all fields
        onUpdateParams(customParams);
        onContinue();
      }
      return;
    }

    if (Number.isNaN(numValue)) {
      setValidationError('Must be a valid number');
      return;
    }

    // Validate the field
    const validation = PARAM_VALIDATORS[currentField](numValue);
    if (!validation.valid) {
      setValidationError(validation.error || 'Invalid value');
      return;
    }

    // Update custom params
    const updated = { ...customParams, [currentField]: numValue };
    setCustomParams(updated);
    setFieldInput('');
    setValidationError(null);

    // Move to next field or complete
    if (currentField === 'temperature') {
      setCurrentField('maxTokens');
    } else if (currentField === 'maxTokens') {
      setCurrentField('contextLimit');
    } else {
      // Done with all fields
      onUpdateParams(updated);
      onContinue();
    }
  }, [fieldInput, currentField, customParams, onUpdateParams, onContinue]);

  const providerDefaults =
    PARAMETER_DEFAULTS[state.config.provider || ''] ||
    PARAMETER_DEFAULTS.anthropic;

  const paramOptions = [
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

  const fieldLabels = {
    temperature: 'Temperature (0.0-2.0)',
    maxTokens: 'Max Tokens (positive integer)',
    contextLimit: 'Context Limit (positive integer)',
  };

  const fieldHelp = {
    temperature:
      'Controls randomness. Lower = more focused, Higher = more creative',
    maxTokens: 'Maximum tokens to generate in responses',
    contextLimit: 'Maximum context window size',
  };

  const { current, total } = getStepPosition(state);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentCyan}>
        Create New Profile - Step {current} of {total}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>Advanced Parameters:</Text>
      <Text color={Colors.Gray}>
        Configure temperature, max tokens, and context limits (optional)
      </Text>
      <Text color={Colors.Foreground}> </Text>

      {focusedComponent === 'select' && (
        <>
          <RadioButtonSelect
            items={paramOptions}
            onSelect={handleParamSelect}
            isFocused={true}
          />
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>Esc Cancel</Text>
        </>
      )}

      {focusedComponent === 'custom' && (
        <>
          <Text color={Colors.Foreground}>{fieldLabels[currentField]}:</Text>
          <Text color={Colors.Gray}>{fieldHelp[currentField]}</Text>
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
              : currentField === 'maxTokens'
                ? '2'
                : '3'}
            /3
          </Text>
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>Enter Continue Esc Back to menu</Text>
        </>
      )}
    </Box>
  );
};
