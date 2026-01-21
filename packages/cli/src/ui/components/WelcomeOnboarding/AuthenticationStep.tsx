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

      // Accept printable characters (including paste - multi-char sequences)
      const char = key.sequence;
      if (char && !key.ctrl && !key.meta) {
        // Filter to only printable ASCII characters (handles both typing and paste)
        const printable = char.replace(/[^\x20-\x7E]/g, '');
        if (printable) {
          setApiKey((prev) => prev + printable);
        }
      }
    },
    { isActive: isFocused },
  );

  // Start OAuth flow automatically - use ref to prevent double-execution
  // React Strict Mode or dependency changes can cause this effect to re-run
  const authStartedRef = React.useRef(false);

  useEffect(() => {
    if (method === 'oauth' && !authStartedRef.current) {
      authStartedRef.current = true;
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
  }, [method, provider, triggerAuth, onComplete, onError]);

  if (method === 'oauth') {
    return (
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
        <Text color={Colors.Foreground}>
          This window will update when done.
        </Text>

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
