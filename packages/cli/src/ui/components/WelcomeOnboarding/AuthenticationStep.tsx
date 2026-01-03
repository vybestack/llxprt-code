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
  onComplete: () => void;
  onError: (error: string) => void;
  onBack: () => void;
  triggerAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;
  isFocused?: boolean;
}

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
  const [authStarted, setAuthStarted] = useState(false);

  const providerDisplay = provider.charAt(0).toUpperCase() + provider.slice(1);

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKey.trim()) {
      return;
    }

    setIsAuthenticating(true);
    try {
      await triggerAuth(provider, 'api_key', apiKey.trim());
      onComplete();
    } catch (error: unknown) {
      setIsAuthenticating(false);
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [apiKey, provider, triggerAuth, onComplete, onError]);

  // Handle keyboard input for API key mode
  useKeypress(
    (key) => {
      if (key.name === 'escape' && !isAuthenticating) {
        onBack();
        return;
      }

      if (method !== 'api_key' || isAuthenticating) {
        return;
      }

      if (key.name === 'return') {
        handleApiKeySubmit();
        return;
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        setApiKey((prev) => prev.slice(0, -1));
        return;
      }

      // Only accept printable characters
      const char = key.sequence;
      if (
        char &&
        char.length === 1 &&
        !key.ctrl &&
        !key.meta &&
        key.insertable
      ) {
        setApiKey((prev) => prev + char);
      }
    },
    { isActive: isFocused },
  );

  // Start OAuth flow automatically
  useEffect(() => {
    if (method === 'oauth' && !authStarted) {
      setAuthStarted(true);
      setIsAuthenticating(true);
      triggerAuth(provider, 'oauth')
        .then(() => {
          onComplete();
        })
        .catch((error: unknown) => {
          setIsAuthenticating(false);
          onError(error instanceof Error ? error.message : String(error));
        });
    }
  }, [method, provider, triggerAuth, onComplete, onError, authStarted]);

  if (method === 'oauth') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={Colors.AccentCyan}>
            Step 3 of 3: Authenticating with {providerDisplay}
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text>
            <Text color={Colors.AccentYellow}>
              <Spinner type="dots" />
            </Text>{' '}
            Opening browser for OAuth authentication...
          </Text>
        </Box>

        <Text>Please complete the authentication in your browser.</Text>
        <Text>This window will update when done.</Text>

        <Box marginTop={1}>
          <Text color={Colors.Gray}>Press Esc to cancel and go back</Text>
        </Box>
      </Box>
    );
  }

  const maskedValue = '•'.repeat(apiKey.length);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 3 of 3: Enter Your API Key
        </Text>
      </Box>

      {isAuthenticating ? (
        <Box marginBottom={1}>
          <Text>
            <Text color={Colors.AccentYellow}>
              <Spinner type="dots" />
            </Text>{' '}
            Validating API key...
          </Text>
        </Box>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text>Enter your {providerDisplay} API key:</Text>
          </Box>

          <Box>
            <Text>API Key: </Text>
            <Text>{maskedValue}</Text>
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
