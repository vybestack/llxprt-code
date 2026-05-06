/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

interface AuthDialogProps {
  onSelect: (authMethod: string | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  initialErrorMessage?: string | null;
}

function getEnabledProviders(
  oauthProviders: Record<string, boolean> | undefined,
): Set<string> {
  const enabled = new Set<string>();
  const providers = oauthProviders ?? {};
  for (const [provider, isEnabled] of Object.entries(providers)) {
    if (isEnabled) {
      enabled.add(`oauth_${provider}`);
    }
  }
  return enabled;
}

const AuthDialogHeader: React.FC = () => (
  <>
    <Text bold color={Colors.Foreground}>
      OAuth Authentication
    </Text>
    <Box marginTop={1}>
      <Text color={Colors.Foreground}>
        Select an OAuth provider to authenticate:
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.DimComment}>
        Note: You can also use API keys via /key, /keyfile, --key, --keyfile,
        --key-name, or environment variables
      </Text>
    </Box>
  </>
);

const AuthDialogFooter: React.FC = () => (
  <>
    <Box marginTop={1}>
      <Text color={Colors.Gray}>(Use Enter to select, ESC to close)</Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.Foreground}>
        Terms of Services and Privacy Notice for Gemini CLI
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.AccentBlue}>
        {
          'https://github.com/acoliver/llxprt-code/blob/main/docs/tos-privacy.md'
        }
      </Text>
    </Box>
  </>
);

function buildAuthItems(enabledProviders: Set<string>): Array<{
  key: string;
  label: string;
  value: string;
}> {
  return [
    {
      key: 'oauth_gemini',
      label: `Gemini (Google OAuth) ${enabledProviders.has('oauth_gemini') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_gemini',
    },
    {
      key: 'oauth_qwen',
      label: `Qwen (OAuth) ${enabledProviders.has('oauth_qwen') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_qwen',
    },
    {
      key: 'oauth_anthropic',
      label: `Anthropic Claude (OAuth) ${enabledProviders.has('oauth_anthropic') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_anthropic',
    },
    {
      key: 'oauth_codex',
      label: `Codex (ChatGPT OAuth) ${enabledProviders.has('oauth_codex') ? '[ON]' : '[OFF]'}`,
      value: 'oauth_codex',
    },
    {
      key: 'close',
      label: 'Close',
      value: 'close',
    },
  ];
}

interface AuthDialogContentProps {
  items: Array<{ key: string; label: string; value: string }>;
  errorMessage: string | null;
  handleAuthSelect: (authMethod: string) => void;
}

const AuthDialogContent: React.FC<AuthDialogContentProps> = ({
  items,
  errorMessage,
  handleAuthSelect,
}) => (
  <>
    <AuthDialogHeader />
    <Box marginTop={1}>
      <RadioButtonSelect
        items={items}
        initialIndex={0}
        onSelect={handleAuthSelect}
      />
    </Box>
    {errorMessage && (
      <Box marginTop={1}>
        <Text color={Colors.AccentRed}>{errorMessage}</Text>
      </Box>
    )}
    <AuthDialogFooter />
  </>
);

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
}: AuthDialogProps): React.JSX.Element {
  const runtime = useRuntimeApi();
  const [errorMessage, setErrorMessage] = useState<string | null>(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string error message should be treated as null
    initialErrorMessage || null,
  );

  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(() =>
    getEnabledProviders(settings.merged.oauthEnabledProviders),
  );

  React.useEffect(() => {
    setEnabledProviders(
      getEnabledProviders(settings.merged.oauthEnabledProviders),
    );
  }, [settings.merged.oauthEnabledProviders]);

  const items = useMemo(
    () => buildAuthItems(enabledProviders),
    [enabledProviders],
  );

  const handleAuthSelect = useCallback(
    (authMethod: string) => {
      setErrorMessage(null);

      if (authMethod === 'close') {
        onSelect(undefined, SettingScope.User);
        return;
      }

      const providerName = authMethod.replace('oauth_', '');
      const oauthManager = runtime.getCliOAuthManager();

      if (oauthManager) {
        void (async () => {
          try {
            const newState =
              await oauthManager.toggleOAuthEnabled(providerName);

            const newEnabledProviders = new Set(enabledProviders);
            if (newState) {
              newEnabledProviders.add(authMethod);
            } else {
              newEnabledProviders.delete(authMethod);
            }
            setEnabledProviders(newEnabledProviders);
          } catch (error) {
            setErrorMessage(`Failed to toggle ${providerName}: ${error}`);
          }
        })();
      }
    },
    [onSelect, enabledProviders, runtime],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
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
      backgroundColor={Colors.Background}
    >
      <AuthDialogContent
        items={items}
        errorMessage={errorMessage}
        handleAuthSelect={handleAuthSelect}
      />
    </Box>
  );
}
