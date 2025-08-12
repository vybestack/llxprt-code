/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
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

function _parseDefaultAuthType(
  defaultAuthType: string | undefined,
): AuthType | null {
  if (
    defaultAuthType &&
    Object.values(AuthType).includes(defaultAuthType as AuthType)
  ) {
    return defaultAuthType as AuthType;
  }
  return null;
}

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
}: AuthDialogProps): React.JSX.Element {
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialErrorMessage || null,
  );

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

  const items = [
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

  // Default to first item (Gemini OAuth)
  const initialAuthIndex = 0;

  // Ensure we have a valid initial index (default to 0 if not found)
  const safeInitialIndex = initialAuthIndex >= 0 ? initialAuthIndex : 0;
  const handleAuthSelect = useCallback(
    async (authMethod: string) => {
      setErrorMessage(null);

      // Handle Close option
      if (authMethod === 'close') {
        onSelect(undefined, SettingScope.User);
        return;
      }

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
    },
    [onSelect, enabledProviders],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        // Allow ESC to close the dialog
        onSelect(undefined, SettingScope.User);
      }
    },
    { isActive: true },
  );

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
          isFocused={true}
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
