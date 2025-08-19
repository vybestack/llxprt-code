/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { AuthType } from '@vybestack/llxprt-code-core';
import { validateAuthMethod as _validateAuthMethod } from '../../config/auth.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface AuthDialogProps {
  onSelect: (authMethod: AuthType | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  initialErrorMessage?: string | null;
}

function parseDefaultAuthType(authType: string): AuthType | null {
  const validAuthTypes = Object.values(AuthType) as string[];
  if (validAuthTypes.includes(authType)) {
    return authType as AuthType;
  }
  return null;
}

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
}: AuthDialogProps): React.JSX.Element {
  // Check for existing API keys and default auth type
  const hasGeminiApiKey = !!process.env.GEMINI_API_KEY;
  const defaultAuthTypeEnv = process.env.GEMINI_DEFAULT_AUTH_TYPE;
  const parsedDefaultAuthType = defaultAuthTypeEnv ? parseDefaultAuthType(defaultAuthTypeEnv) : null;
  
  // Initialize error message - check for invalid auth type immediately
  const initialError = (() => {
    if (initialErrorMessage) return initialErrorMessage;
    if (defaultAuthTypeEnv && !parsedDefaultAuthType) {
      return `Invalid value for GEMINI_DEFAULT_AUTH_TYPE: "${defaultAuthTypeEnv}"`;
    }
    return null;
  })();

  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  

  // Handle ESC key exit logic
  const handleEscapeKey = useCallback(() => {
    // Check if we have an existing auth method already selected
    const existingAuthType = settings.merged.selectedAuthType;
    
    if (existingAuthType) {
      // Allow exit if auth method is already selected
      onSelect(undefined, SettingScope.User);
    } else if (errorMessage) {
      // If there's an error message, don't allow exit - user must resolve it first
      // Don't call onSelect, just stay in the dialog
      return;
    } else {
      // Prevent exit and show error message
      setErrorMessage('You must select an auth method to proceed. Press Ctrl+C twice to exit.');
    }
  }, [settings.merged.selectedAuthType, errorMessage, onSelect]);

  // Track enabled providers from settings (oauthEnabledProviders is an object)
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(() => {
    const oauthProviders = settings.merged.oauthEnabledProviders || {};
    const enabled = new Set<string>();
    for (const [provider, isEnabled] of Object.entries(oauthProviders)) {
      if (isEnabled) {
        enabled.add(`oauth_${provider}`);
      }
    }
    return enabled;
  });

  // Determine if we should show API key detection or OAuth interface
  const shouldShowApiKeyDetection = useMemo(() => 
    // Show API key detection if:
    // 1. GEMINI_API_KEY is present AND
    // 2. Either no default auth type is set, or it's set to USE_GEMINI
    hasGeminiApiKey && (!parsedDefaultAuthType || parsedDefaultAuthType === AuthType.USE_GEMINI)
  , [hasGeminiApiKey, parsedDefaultAuthType]);

  // Determine if we should show OAuth interface instead
  const shouldShowOAuthInterface = useMemo(() => 
    // For now, don't show OAuth interface by default - keep traditional behavior
    // OAuth can be enabled through specific settings or commands
    false
  , []);

  // Create different item lists based on what we're showing
  const oauthItems = [
    {
      label: `Gemini (Google OAuth) ${enabledProviders.has('oauth_gemini') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_gemini',
    },
    {
      label: `Qwen (OAuth) ${enabledProviders.has('oauth_qwen') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_qwen',
    },
    {
      label: `Anthropic Claude (OAuth) ${enabledProviders.has('oauth_anthropic') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_anthropic',
    },
    {
      label: 'Close',
      value: 'close',
    },
  ];

  const authItems = [
    { label: 'Login with Google', value: AuthType.LOGIN_WITH_GOOGLE },
    { label: 'Use Gemini API key', value: AuthType.USE_GEMINI },
    { label: 'Use Vertex AI', value: AuthType.USE_VERTEX_AI },
    { label: 'Cloud Shell', value: AuthType.CLOUD_SHELL },
    { label: 'Use provider', value: AuthType.USE_PROVIDER },
    { label: 'None', value: AuthType.USE_NONE },
  ];

  // Determine initial selection based on environment variables or settings
  const getInitialAuthIndex = () => {
    if (parsedDefaultAuthType) {
      const index = authItems.findIndex(item => item.value === parsedDefaultAuthType);
      return index >= 0 ? index : 0;
    }
    // Default to LOGIN_WITH_GOOGLE (index 0)
    return 0;
  };

  const initialAuthIndex = shouldShowOAuthInterface ? 0 : getInitialAuthIndex();
  const items = shouldShowOAuthInterface ? oauthItems : authItems;
  const safeInitialIndex = initialAuthIndex >= 0 ? initialAuthIndex : 0;
  const handleAuthSelect = useCallback(
    async (authMethod: string) => {
      setErrorMessage(null);

      // Handle Close option for OAuth interface
      if (authMethod === 'close') {
        onSelect(undefined, SettingScope.User);
        return;
      }

      // Handle OAuth provider toggles
      if (shouldShowOAuthInterface && authMethod.startsWith('oauth_')) {
        // Map oauth_gemini -> gemini, etc.
        const providerName = authMethod.replace('oauth_', '');

        // Use the actual oauthManager to toggle the provider
        // This will call the same code as /auth gemini enable/disable
        const { getOAuthManager } = await import(
          '../../providers/providerManagerInstance.js'
        );
        const oauthManager = getOAuthManager();

        if (oauthManager) {
          try {
            await oauthManager.toggleOAuthEnabled(providerName);

            // Update local state to reflect the change
            const newEnabledProviders = new Set(enabledProviders);
            if (newEnabledProviders.has(authMethod)) {
              newEnabledProviders.delete(authMethod);
            } else {
              newEnabledProviders.add(authMethod);
            }
            setEnabledProviders(newEnabledProviders);
          } catch (error) {
            setErrorMessage(`Failed to toggle ${providerName}: ${error}`);
          }
        }

        // Don't close the dialog - let user continue toggling
        return;
      }

      // Handle regular auth method selection
      const authType = authMethod as AuthType;
      const validationError = _validateAuthMethod(authType);
      
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      onSelect(authType, SettingScope.User);
    },
    [onSelect, enabledProviders, shouldShowOAuthInterface],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        handleEscapeKey();
      }
    },
    { isActive: true },
  );

  // If we should show API key detection, render that interface
  if (shouldShowApiKeyDetection) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>API Key Authentication</Text>
        <Box marginTop={1}>
          <Text color={Colors.AccentGreen}>
            Existing API key detected (GEMINI_API_KEY)
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            You can continue using your existing API key, or select a different authentication method below:
          </Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={items}
            initialIndex={safeInitialIndex}
            onSelect={handleAuthSelect}
          />
        </Box>
        {errorMessage && (
          <Box marginTop={1}>
            <Text color={Colors.AccentRed}>{errorMessage}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={Colors.Gray}>(Use Enter to select, ESC to exit)</Text>
        </Box>
      </Box>
    );
  }

  // If we should show OAuth interface, render that
  if (shouldShowOAuthInterface) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>OAuth Authentication</Text>
        <Box marginTop={1}>
          <Text>Select an OAuth provider to authenticate:</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Note: You can also use API keys via /key, /keyfile, --key, --keyfile,
            or environment variables
          </Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={items}
            initialIndex={safeInitialIndex}
            onSelect={handleAuthSelect}
          />
        </Box>
        {errorMessage && (
          <Box marginTop={1}>
            <Text color={Colors.AccentRed}>{errorMessage}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={Colors.Gray}>(Use Enter to select, ESC to close)</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Terms of Services and Privacy Notice for Gemini CLI</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.AccentBlue}>
            {
              'https://github.com/acoliver/llxprt-code/blob/main/docs/tos-privacy.md'
            }
          </Text>
        </Box>
      </Box>
    );
  }

  // Default: show regular auth method selection
  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Authentication Method Selection</Text>
      <Box marginTop={1}>
        <Text>Select an authentication method:</Text>
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={safeInitialIndex}
          onSelect={handleAuthSelect}
        />
      </Box>
      {errorMessage && (
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{errorMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>(Use Enter to select, ESC to exit)</Text>
      </Box>
    </Box>
  );
}
