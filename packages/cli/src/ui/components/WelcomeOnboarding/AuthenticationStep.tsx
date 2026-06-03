/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';

interface AuthenticationStepProps {
  provider: string;
  method: 'oauth' | 'api_key';
  onComplete: () => void | Promise<void>;
  onError: (error: string) => void;
  onBack: () => void;
  triggerAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;
  isFocused?: boolean;
}

const OAuthFlowContent: React.FC<{ providerDisplay: string }> = ({
  providerDisplay,
}) => (
  <Box flexDirection="column">
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={Colors.AccentCyan}>
        Step 4 of 5: Authenticating with {providerDisplay}
      </Text>
    </Box>
    <Box marginBottom={1}>
      <Text color={Colors.Foreground}>
        <Text color={Colors.AccentYellow}>
          <Spinner type="dots" />
        </Text>{' '}
        Opening browser for OAuth authentication...
      </Text>
    </Box>
    <Text color={Colors.Foreground}>
      Please complete the authentication in your browser.
    </Text>
    <Text color={Colors.Foreground}>This window will update when done.</Text>
    <Box marginTop={1}>
      <Text color={Colors.Gray}>Press Esc to cancel and go back</Text>
    </Box>
  </Box>
);

const ApiKeyInputContent: React.FC<{
  providerDisplay: string;
  apiKey: string;
  isAuthenticating: boolean;
}> = ({ providerDisplay, apiKey, isAuthenticating }) => {
  const maskedValue = '•'.repeat(apiKey.length);
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 4 of 5: Enter Your API Key
        </Text>
      </Box>
      {isAuthenticating ? (
        <Box marginBottom={1}>
          <Text color={Colors.Foreground}>
            <Text color={Colors.AccentYellow}>
              <Spinner type="dots" />
            </Text>{' '}
            Validating API key...
          </Text>
        </Box>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text color={Colors.Foreground}>
              Enter your {providerDisplay} API key:
            </Text>
          </Box>
          <Box>
            <Text color={Colors.Foreground}>API Key: </Text>
            <Text color={Colors.Foreground}>{maskedValue}</Text>
            <Text color={Colors.AccentCyan}>▌</Text>
          </Box>
        </>
      )}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Enter when done, Esc to go back</Text>
      </Box>
    </Box>
  );
};

export const AuthenticationStep: React.FC<AuthenticationStepProps> = ({
  provider,
  method,
  onComplete,
  onError,
  onBack,
  triggerAuth,
  isFocused = true,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const providerDisplay = provider.charAt(0).toUpperCase() + provider.slice(1);

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKey.trim()) return;
    setIsAuthenticating(true);
    try {
      await triggerAuth(provider, 'api_key', apiKey.trim());
      await onComplete();
    } catch (error: unknown) {
      setIsAuthenticating(false);
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [apiKey, provider, triggerAuth, onComplete, onError]);

  useKeypress(
    (key) => {
      if (key.name === 'escape' && !isAuthenticating) {
        onBack();
        return;
      }
      if (method !== 'api_key' || isAuthenticating) return;
      if (key.name === 'return') {
        void handleApiKeySubmit();
        return;
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        setApiKey((prev) => prev.slice(0, -1));
        return;
      }
      const char = key.sequence;
      if (char && !key.ctrl && !key.meta) {
        const printable = char.replace(/[^\x20-\x7E]/g, '');
        if (printable) {
          setApiKey((prev) => prev + printable);
        }
      }
    },
    { isActive: isFocused },
  );

  const authStartedRef = React.useRef(false);

  useEffect(() => {
    if (method === 'oauth' && !authStartedRef.current) {
      authStartedRef.current = true;
      setIsAuthenticating(true);
      triggerAuth(provider, 'oauth')
        .then(async () => {
          await onComplete();
        })
        .catch((error: unknown) => {
          setIsAuthenticating(false);
          onError(error instanceof Error ? error.message : String(error));
        });
    }
  }, [method, provider, triggerAuth, onComplete, onError]);

  if (method === 'oauth') {
    return <OAuthFlowContent providerDisplay={providerDisplay} />;
  }

  return (
    <ApiKeyInputContent
      providerDisplay={providerDisplay}
      apiKey={apiKey}
      isAuthenticating={isAuthenticating}
    />
  );
};
