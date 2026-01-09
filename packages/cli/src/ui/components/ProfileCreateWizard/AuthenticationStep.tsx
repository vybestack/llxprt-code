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
import { PROVIDER_OPTIONS } from './constants.js';
import { validateKeyFile } from './validation.js';
import { getStepPosition } from './utils.js';
import type { WizardState } from './types.js';

interface AuthenticationStepProps {
  state: WizardState;
  onUpdateAuth: (auth: WizardState['config']['auth']) => void;
  onContinue: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export const AuthenticationStep: React.FC<AuthenticationStepProps> = ({
  state,
  onUpdateAuth,
  onContinue,
  onBack,
  onCancel: _onCancel,
}) => {
  const [focusedComponent, setFocusedComponent] = useState<'select' | 'input'>(
    'select',
  );
  const [authMethod, setAuthMethod] = useState<
    'apikey' | 'keyfile' | 'oauth' | 'skip' | null
  >(null);
  const [authInput, setAuthInput] = useState('');
  const [oauthBuckets, setOauthBuckets] = useState('default');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPathValidated, setIsPathValidated] = useState(false);

  const providerOption = PROVIDER_OPTIONS.find(
    (p) => p.value === state.config.provider,
  );

  // Handle Escape key to go back
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'input') {
          // Go back to auth method selection
          setFocusedComponent('select');
          setValidationError(null);
        } else if (focusedComponent === 'select') {
          // Go back to previous step
          onBack();
        }
      }
    },
    { isActive: true },
  );

  const handleAuthSelect = useCallback(
    (value: string) => {
      if (value === 'oauth') {
        setAuthMethod('oauth');
        setFocusedComponent('input'); // Show OAuth bucket input
      } else if (value === 'skip') {
        setAuthMethod('skip');
        onUpdateAuth({ type: null });
        onContinue();
      } else if (value === 'apikey') {
        setAuthMethod('apikey');
        setFocusedComponent('input');
      } else if (value === 'keyfile') {
        setAuthMethod('keyfile');
        setFocusedComponent('input');
      } else if (value === '__back__') {
        onBack();
      }
    },
    [onUpdateAuth, onContinue, onBack],
  );

  const handleAuthInputChange = useCallback((value: string) => {
    setAuthInput(value);
    setValidationError(null);
    setIsPathValidated(false);
  }, []);

  const handleAuthInputSubmit = useCallback(async () => {
    // OAuth bucket input
    if (authMethod === 'oauth') {
      const buckets = oauthBuckets
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
      onUpdateAuth({
        type: 'oauth',
        buckets: buckets.length > 0 ? buckets : ['default'],
      });
      onContinue();
      return;
    }

    // API key or keyfile
    if (!authInput.trim()) {
      setValidationError('This field cannot be empty');
      return;
    }

    // Validate keyfile path if keyfile method
    if (authMethod === 'keyfile') {
      const validation = await validateKeyFile(authInput);
      if (!validation.valid) {
        setValidationError(validation.error || 'Invalid file path');
        return;
      }
      setIsPathValidated(true);
    }

    setValidationError(null);

    // Store auth value and proceed
    if (authMethod === 'apikey') {
      onUpdateAuth({ type: 'apikey', value: authInput });
    } else if (authMethod === 'keyfile') {
      onUpdateAuth({ type: 'keyfile', value: authInput });
    }

    // Proceed to next step
    onContinue();
  }, [authInput, authMethod, oauthBuckets, onUpdateAuth, onContinue]);

  // Build auth options based on provider
  const authOptions: Array<{ label: string; value: string; key: string }> = [];

  // API key option
  authOptions.push({
    label: 'Enter API key now',
    value: 'apikey',
    key: 'apikey',
  });

  // Key file option
  authOptions.push({
    label: 'Use key file (provide path)',
    value: 'keyfile',
    key: 'keyfile',
  });

  // OAuth option (only if supported)
  if (providerOption?.supportsOAuth) {
    authOptions.push({
      label: 'OAuth (authenticate when needed)',
      value: 'oauth',
      key: 'oauth',
    });
  }

  // Always allow skipping auth (can be configured later)
  authOptions.push({
    label: 'Skip for now (configure manually later)',
    value: 'skip',
    key: 'skip',
  });

  // Back option
  authOptions.push({
    label: '← Back',
    value: '__back__',
    key: '__back__',
  });

  const { current, total } = getStepPosition(state);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentCyan}>
        Create New Profile - Step {current} of {total}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>
        {focusedComponent === 'input'
          ? authMethod === 'apikey'
            ? 'Enter API Key:'
            : authMethod === 'keyfile'
              ? 'Specify Key File:'
              : 'Configure OAuth:'
          : 'Authentication:'}
      </Text>
      <Text color={Colors.Gray}>
        {focusedComponent === 'input'
          ? authMethod === 'apikey'
            ? `Enter your ${providerOption?.label || state.config.provider} API key:`
            : authMethod === 'keyfile'
              ? 'Enter the path to your API key file:'
              : 'OAuth authentication will be set up when you load this profile'
          : `Choose how to authenticate with ${providerOption?.label || state.config.provider}`}
      </Text>
      <Text color={Colors.Foreground}> </Text>

      {focusedComponent === 'select' && (
        <>
          <RadioButtonSelect
            items={authOptions}
            onSelect={handleAuthSelect}
            isFocused={true}
          />
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>Esc Back</Text>
        </>
      )}

      {focusedComponent === 'input' && authMethod === 'apikey' && (
        <>
          <Text color={Colors.Foreground}>API Key:</Text>
          <TextInput
            value={authInput}
            onChange={handleAuthInputChange}
            onSubmit={handleAuthInputSubmit}
            isFocused={true}
            mask={true}
            placeholder="sk-..."
          />
          {validationError && (
            <Text color={Colors.AccentRed}>✗ {validationError}</Text>
          )}
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            ℹ Your key will be stored in the profile JSON file.
          </Text>
          <Text color={Colors.Gray}>
            For better security, consider using a key file instead.
          </Text>
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>Enter Continue Esc Back to list</Text>
        </>
      )}

      {focusedComponent === 'input' && authMethod === 'keyfile' && (
        <>
          <Text color={Colors.Foreground}>Key file path:</Text>
          <TextInput
            value={authInput}
            onChange={handleAuthInputChange}
            onSubmit={handleAuthInputSubmit}
            isFocused={true}
            placeholder="~/.keys/provider.key"
          />
          {validationError && (
            <Text color={Colors.AccentRed}>✗ {validationError}</Text>
          )}
          {!validationError && isPathValidated && (
            <Text color={Colors.AccentGreen}>✓ Valid path</Text>
          )}
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            ℹ Supports ~ expansion for home directory
          </Text>
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            ← → Move cursor Enter Continue Esc Back to list
          </Text>
        </>
      )}

      {focusedComponent === 'input' && authMethod === 'oauth' && (
        <>
          <Text color={Colors.Foreground}>OAuth Buckets (optional):</Text>
          <Text color={Colors.Gray}>
            Enter comma-separated bucket names, or leave empty for default
          </Text>
          <Text color={Colors.Foreground}> </Text>
          <TextInput
            value={oauthBuckets}
            onChange={setOauthBuckets}
            onSubmit={handleAuthInputSubmit}
            isFocused={true}
            placeholder="default, work"
          />
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>
            ℹ You&apos;ll authenticate when you first load this profile
          </Text>
          <Text color={Colors.Foreground}> </Text>
          <Text color={Colors.Gray}>Enter Continue Esc Back to list</Text>
        </>
      )}
    </Box>
  );
};
