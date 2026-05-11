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
import { PROVIDER_OPTIONS } from './constants.js';
import { validateKeyFile } from './validation.js';
import { getStepPosition } from './utils.js';
import type { WizardState } from './types.js';

const buildAuthOptions = (
  providerOption: { supportsOAuth?: boolean } | undefined,
): Array<{ label: string; value: string; key: string }> => {
  const options: Array<{ label: string; value: string; key: string }> = [
    { label: 'Enter API key now', value: 'apikey', key: 'apikey' },
    { label: 'Use key file (provide path)', value: 'keyfile', key: 'keyfile' },
  ];

  if (providerOption?.supportsOAuth ?? false) {
    options.push({
      label: 'OAuth (authenticate when needed)',
      value: 'oauth',
      key: 'oauth',
    });
  }

  options.push(
    {
      label: 'Skip for now (configure manually later)',
      value: 'skip',
      key: 'skip',
    },
    { label: '← Back', value: '__back__', key: '__back__' },
  );

  return options;
};

const AuthApiKeyInput: React.FC<{
  authInput: string;
  validationError: string | null;
  handleAuthInputChange: (value: string) => void;
  handleAuthInputSubmit: () => void;
}> = ({
  authInput,
  validationError,
  handleAuthInputChange,
  handleAuthInputSubmit,
}) => (
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
);

const AuthKeyFileInput: React.FC<{
  authInput: string;
  validationError: string | null;
  isPathValidated: boolean;
  handleAuthInputChange: (value: string) => void;
  handleAuthInputSubmit: () => void;
}> = ({
  authInput,
  validationError,
  isPathValidated,
  handleAuthInputChange,
  handleAuthInputSubmit,
}) => (
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
    <Text color={Colors.Gray}>ℹ Supports ~ expansion for home directory</Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>
      ← → Move cursor Enter Continue Esc Back to list
    </Text>
  </>
);

const AuthOAuthInput: React.FC<{
  oauthBuckets: string;
  onOauthBucketsChange: (value: string) => void;
  handleAuthInputSubmit: () => void;
}> = ({ oauthBuckets, onOauthBucketsChange, handleAuthInputSubmit }) => (
  <>
    <Text color={Colors.Foreground}>OAuth Buckets (optional):</Text>
    <Text color={Colors.Gray}>
      Enter comma-separated bucket names, or leave empty for default
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <TextInput
      value={oauthBuckets}
      onChange={onOauthBucketsChange}
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
);

const AuthHeaderView: React.FC<{
  focusedComponent: 'select' | 'input';
  authMethod: AuthMethod;
  providerLabel: string | null;
}> = ({ focusedComponent, authMethod, providerLabel }) => (
  <>
    <Text color={Colors.Foreground}>
      {focusedComponent === 'input'
        ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          authMethod === 'apikey'
          ? 'Enter API Key:'
          : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            authMethod === 'keyfile'
            ? 'Specify Key File:'
            : 'Configure OAuth:'
        : 'Authentication:'}
    </Text>
    <Text color={Colors.Gray}>
      {focusedComponent === 'input'
        ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          authMethod === 'apikey'
          ? `Enter your ${providerLabel} API key:`
          : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            authMethod === 'keyfile'
            ? 'Enter the path to your API key file:'
            : 'OAuth authentication will be set up when you load this profile'
        : `Choose how to authenticate with ${providerLabel}`}
    </Text>
  </>
);

const processAuthSubmit = async (
  authMethod: 'apikey' | 'keyfile' | 'oauth' | 'skip' | null,
  authInput: string,
  oauthBuckets: string,
  onUpdateAuth: (auth: WizardState['config']['auth']) => void,
  onContinue: () => void,
  setValidationError: (v: string | null) => void,
  setIsPathValidated: (v: boolean) => void,
) => {
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

  if (!authInput.trim()) {
    setValidationError('This field cannot be empty');
    return;
  }

  if (authMethod === 'keyfile') {
    const validation = await validateKeyFile(authInput);
    if (!validation.valid) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string error should use default message
      setValidationError(validation.error || 'Invalid file path');
      return;
    }
    setIsPathValidated(true);
  }

  setValidationError(null);

  if (authMethod === 'apikey') {
    onUpdateAuth({ type: 'apikey', value: authInput });
  } else if (authMethod === 'keyfile') {
    onUpdateAuth({ type: 'keyfile', value: authInput });
  }

  onContinue();
};

type AuthMethod = 'apikey' | 'keyfile' | 'oauth' | 'skip' | null;

const AuthSelectView: React.FC<{
  authOptions: Array<{ label: string; value: string; key: string }>;
  handleAuthSelect: (value: string) => void;
}> = ({ authOptions, handleAuthSelect }) => (
  <>
    <RadioButtonSelect
      items={authOptions}
      onSelect={handleAuthSelect}
      isFocused={true}
    />
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>Esc Back</Text>
  </>
);

const AuthInputView: React.FC<{
  authMethod: AuthMethod;
  authInput: string;
  validationError: string | null;
  isPathValidated: boolean;
  oauthBuckets: string;
  handleAuthInputChange: (value: string) => void;
  handleAuthInputSubmit: () => void;
  onOauthBucketsChange: (value: string) => void;
}> = ({
  authMethod,
  authInput,
  validationError,
  isPathValidated,
  oauthBuckets,
  handleAuthInputChange,
  handleAuthInputSubmit,
  onOauthBucketsChange,
}) => (
  <>
    {authMethod === 'apikey' && (
      <AuthApiKeyInput
        authInput={authInput}
        validationError={validationError}
        handleAuthInputChange={handleAuthInputChange}
        handleAuthInputSubmit={handleAuthInputSubmit}
      />
    )}
    {authMethod === 'keyfile' && (
      <AuthKeyFileInput
        authInput={authInput}
        validationError={validationError}
        isPathValidated={isPathValidated}
        handleAuthInputChange={handleAuthInputChange}
        handleAuthInputSubmit={handleAuthInputSubmit}
      />
    )}
    {authMethod === 'oauth' && (
      <AuthOAuthInput
        oauthBuckets={oauthBuckets}
        onOauthBucketsChange={onOauthBucketsChange}
        handleAuthInputSubmit={handleAuthInputSubmit}
      />
    )}
  </>
);

const useEscapeHandler = (
  focusedComponent: 'select' | 'input',
  setFocusedComponent: (v: 'select' | 'input') => void,
  setValidationError: (v: string | null) => void,
  onBack: () => void,
) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'input') {
          setFocusedComponent('select');
          setValidationError(null);
        } else {
          onBack();
        }
      }
    },
    { isActive: true },
  );
};

const applyAuthSelection = (
  value: string,
  setAuthMethod: (m: AuthMethod) => void,
  setFocusedComponent: (v: 'select' | 'input') => void,
  onUpdateAuth: (auth: WizardState['config']['auth']) => void,
  onContinue: () => void,
  onBack: () => void,
) => {
  if (value === 'oauth') {
    setAuthMethod('oauth');
    setFocusedComponent('input');
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
};

const AuthStepHeader: React.FC<{
  current: number;
  total: number;
  focusedComponent: 'select' | 'input';
  authMethod: AuthMethod;
  providerLabel: string | null;
}> = ({ current, total, focusedComponent, authMethod, providerLabel }) => (
  <>
    <Text bold color={Colors.AccentCyan}>
      Create New Profile - Step {current} of {total}
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <AuthHeaderView
      focusedComponent={focusedComponent}
      authMethod={authMethod}
      providerLabel={providerLabel}
    />
    <Text color={Colors.Foreground}> </Text>
  </>
);

const AuthContentView: React.FC<{
  focusedComponent: 'select' | 'input';
  authOptions: Array<{ label: string; value: string; key: string }>;
  handleAuthSelect: (value: string) => void;
  authMethod: AuthMethod;
  authInput: string;
  validationError: string | null;
  isPathValidated: boolean;
  oauthBuckets: string;
  handleAuthInputChange: (value: string) => void;
  handleAuthInputSubmit: () => void;
  onOauthBucketsChange: (value: string) => void;
}> = ({
  focusedComponent,
  authOptions,
  handleAuthSelect,
  authMethod,
  authInput,
  validationError,
  isPathValidated,
  oauthBuckets,
  handleAuthInputChange,
  handleAuthInputSubmit,
  onOauthBucketsChange,
}) => (
  <>
    {focusedComponent === 'select' && (
      <AuthSelectView
        authOptions={authOptions}
        handleAuthSelect={handleAuthSelect}
      />
    )}
    {focusedComponent === 'input' && (
      <AuthInputView
        authMethod={authMethod}
        authInput={authInput}
        validationError={validationError}
        isPathValidated={isPathValidated}
        oauthBuckets={oauthBuckets}
        handleAuthInputChange={handleAuthInputChange}
        handleAuthInputSubmit={handleAuthInputSubmit}
        onOauthBucketsChange={onOauthBucketsChange}
      />
    )}
  </>
);

const useAuthState = (state: WizardState) => {
  const [focusedComponent, setFocusedComponent] = useState<'select' | 'input'>(
    'select',
  );
  const [authMethod, setAuthMethod] = useState<AuthMethod>(null);
  const [authInput, setAuthInput] = useState('');
  const [oauthBuckets, setOauthBuckets] = useState('default');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPathValidated, setIsPathValidated] = useState(false);
  const providerOption = PROVIDER_OPTIONS.find(
    (p) => p.value === state.config.provider,
  );
  return {
    focusedComponent,
    setFocusedComponent,
    authMethod,
    setAuthMethod,
    authInput,
    setAuthInput,
    oauthBuckets,
    setOauthBuckets,
    validationError,
    setValidationError,
    isPathValidated,
    setIsPathValidated,
    providerOption,
  };
};

const useAuthHandlers = (
  setAuthMethod: React.Dispatch<React.SetStateAction<AuthMethod>>,
  setFocusedComponent: React.Dispatch<React.SetStateAction<'select' | 'input'>>,
  setAuthInput: React.Dispatch<React.SetStateAction<string>>,
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsPathValidated: React.Dispatch<React.SetStateAction<boolean>>,
  authMethod: AuthMethod,
  authInput: string,
  oauthBuckets: string,
  onUpdateAuth: (auth: WizardState['config']['auth']) => void,
  onContinue: () => void,
  onBack: () => void,
) => {
  const handleAuthSelect = useCallback(
    (value: string) => {
      applyAuthSelection(
        value,
        setAuthMethod,
        setFocusedComponent,
        onUpdateAuth,
        onContinue,
        onBack,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState setters are stable
    [onUpdateAuth, onContinue, onBack],
  );
  const handleAuthInputChange = useCallback((value: string) => {
    setAuthInput(value);
    setValidationError(null);
    setIsPathValidated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState setters are stable
  }, []);
  const handleAuthInputSubmit = useCallback(() => {
    void (async () => {
      try {
        await processAuthSubmit(
          authMethod,
          authInput,
          oauthBuckets,
          onUpdateAuth,
          onContinue,
          setValidationError,
          setIsPathValidated,
        );
      } catch (error) {
        setValidationError(
          error instanceof Error
            ? error.message
            : 'Authentication setup failed',
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState setters are stable
  }, [authInput, authMethod, oauthBuckets, onUpdateAuth, onContinue]);
  return { handleAuthSelect, handleAuthInputChange, handleAuthInputSubmit };
};

const AuthReturnView: React.FC<{
  current: number;
  total: number;
  focusedComponent: 'select' | 'input';
  authMethod: AuthMethod;
  providerLabel: string | null;
  authOptions: Array<{ label: string; value: string; key: string }>;
  handleAuthSelect: (value: string) => void;
  authInput: string;
  validationError: string | null;
  isPathValidated: boolean;
  oauthBuckets: string;
  handleAuthInputChange: (value: string) => void;
  handleAuthInputSubmit: () => void;
  onOauthBucketsChange: (value: string) => void;
}> = ({
  current,
  total,
  focusedComponent,
  authMethod,
  providerLabel,
  authOptions,
  handleAuthSelect,
  authInput,
  validationError,
  isPathValidated,
  oauthBuckets,
  handleAuthInputChange,
  handleAuthInputSubmit,
  onOauthBucketsChange,
}) => (
  <Box flexDirection="column">
    <AuthStepHeader
      current={current}
      total={total}
      focusedComponent={focusedComponent}
      authMethod={authMethod}
      providerLabel={providerLabel}
    />
    <AuthContentView
      focusedComponent={focusedComponent}
      authOptions={authOptions}
      handleAuthSelect={handleAuthSelect}
      authMethod={authMethod}
      authInput={authInput}
      validationError={validationError}
      isPathValidated={isPathValidated}
      oauthBuckets={oauthBuckets}
      handleAuthInputChange={handleAuthInputChange}
      handleAuthInputSubmit={handleAuthInputSubmit}
      onOauthBucketsChange={onOauthBucketsChange}
    />
  </Box>
);

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
  const {
    focusedComponent,
    setFocusedComponent,
    authMethod,
    setAuthMethod,
    authInput,
    setAuthInput,
    oauthBuckets,
    setOauthBuckets,
    validationError,
    setValidationError,
    isPathValidated,
    setIsPathValidated,
    providerOption,
  } = useAuthState(state);

  useEscapeHandler(
    focusedComponent,
    setFocusedComponent,
    setValidationError,
    onBack,
  );

  const { handleAuthSelect, handleAuthInputChange, handleAuthInputSubmit } =
    useAuthHandlers(
      setAuthMethod,
      setFocusedComponent,
      setAuthInput,
      setValidationError,
      setIsPathValidated,
      authMethod,
      authInput,
      oauthBuckets,
      onUpdateAuth,
      onContinue,
      onBack,
    );

  const authOptions = buildAuthOptions(providerOption);
  const { current, total } = getStepPosition(state);

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string label fallback
  const providerLabel = providerOption?.label || state.config.provider;

  return (
    <AuthReturnView
      current={current}
      total={total}
      focusedComponent={focusedComponent}
      authMethod={authMethod}
      providerLabel={providerLabel}
      authOptions={authOptions}
      handleAuthSelect={handleAuthSelect}
      authInput={authInput}
      validationError={validationError}
      isPathValidated={isPathValidated}
      oauthBuckets={oauthBuckets}
      handleAuthInputChange={handleAuthInputChange}
      handleAuthInputSubmit={handleAuthInputSubmit}
      onOauthBucketsChange={setOauthBuckets}
    />
  );
};
