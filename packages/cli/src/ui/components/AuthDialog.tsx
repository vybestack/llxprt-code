/**
 * @license
 * Copyright 2025 Vybestack LLC
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

// TODO: Re-add _parseDefaultAuthType if needed for future auth type parsing
// function was removed as it was unused

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
  const [authenticatedProviders, setAuthenticatedProviders] = useState<
    Record<string, boolean>
  >({});

  // Update enabledProviders state when settings change
  React.useEffect(() => {
    const oauthProviders = settings.merged.oauthEnabledProviders || {};
    const enabled = new Set<string>();
    for (const [provider, isEnabled] of Object.entries(oauthProviders)) {
      if (isEnabled) {
        enabled.add(`oauth_${provider}`);
      }
    }
    setEnabledProviders(enabled);
  }, [settings.merged.oauthEnabledProviders]);

  const loadAuthStatuses = useCallback(async (): Promise<
    Record<string, boolean>
  > => {
    try {
      const { getOAuthManager } = await import(
        '../../providers/providerManagerInstance.js'
      );
      const oauthManager = getOAuthManager();
      if (!oauthManager || typeof oauthManager.getAuthStatus !== 'function') {
        return {};
      }
      const statuses = await oauthManager.getAuthStatus();
      const entries = statuses.map(
        (status) => [status.provider, status.authenticated] as const,
      );
      return Object.fromEntries(entries);
    } catch {
      return {};
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    const run = async () => {
      const nextStatuses = await loadAuthStatuses();
      if (active) {
        setAuthenticatedProviders(nextStatuses);
      }
    };
    void run();

    return () => {
      active = false;
    };
  }, [loadAuthStatuses]);

  const getAuthSuffix = (providerName: string): string => {
    const status = authenticatedProviders[providerName];
    if (status === undefined) {
      return '';
    }
    return status ? ' (Authenticated)' : ' (Not authenticated)';
  };

  const items = [
    {
      label: `Gemini (Google OAuth) ${enabledProviders.has('oauth_gemini') ? '[ON]' : '[OFF]'}${getAuthSuffix('gemini')}`,
      value: 'oauth_gemini',
    },
    {
      label: `Qwen (OAuth) ${enabledProviders.has('oauth_qwen') ? '[ON]' : '[OFF]'}${getAuthSuffix('qwen')}`,
      value: 'oauth_qwen',
    },
    {
      label: `Anthropic Claude (OAuth) ${enabledProviders.has('oauth_anthropic') ? '[ON]' : '[OFF]'}${getAuthSuffix('anthropic')}`,
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
          const newState = await oauthManager.toggleOAuthEnabled(providerName);

          // Update local state to reflect the change
          setEnabledProviders((prev) => {
            const next = new Set(prev);
            if (newState) {
              next.add(authMethod);
            } else {
              next.delete(authMethod);
            }
            return next;
          });

          const nextStatuses = await loadAuthStatuses();
          setAuthenticatedProviders(nextStatuses);
        } catch (error) {
          setErrorMessage(`Failed to toggle ${providerName}: ${error}`);
        }
      }

      // Don't close the dialog - let user continue toggling
    },
    [onSelect, loadAuthStatuses],
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
        <Text>Terms of Services and Privacy Notice for LLxprt Code</Text>
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
