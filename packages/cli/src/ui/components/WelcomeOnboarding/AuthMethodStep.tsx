/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from '../shared/RadioButtonSelect.js';

// Providers that support OAuth
const OAUTH_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'gemini',
  'qwen',
  'codex',
]);

const API_KEY_URLS: Record<string, string> = {
  anthropic: 'console.anthropic.com/settings/keys',
  openai: 'platform.openai.com/api-keys',
  gemini: 'aistudio.google.com/app/apikey',
  deepseek: 'platform.deepseek.com/api_keys',
  qwen: 'dashscope.console.aliyun.com/apiKey',
};

type AuthMethod = 'oauth' | 'api_key' | 'back';

interface AuthMethodStepProps {
  provider: string;
  onSelect: (method: 'oauth' | 'api_key') => void;
  onBack: () => void;
  error?: string;
  isFocused?: boolean;
}

export const AuthMethodStep: React.FC<AuthMethodStepProps> = ({
  provider,
  onSelect,
  onBack,
  error,
  isFocused = true,
}) => {
  const supportsOAuth = OAUTH_PROVIDERS.has(provider);
  const apiKeyUrl = API_KEY_URLS[provider];

  const options: Array<RadioSelectItem<AuthMethod>> = useMemo(() => {
    const opts: Array<RadioSelectItem<AuthMethod>> = [];

    if (supportsOAuth) {
      opts.push({
        label: 'OAuth (Recommended - secure & easy)',
        value: 'oauth',
        key: 'oauth',
      });
    }

    opts.push({
      label: 'API Key',
      value: 'api_key',
      key: 'api_key',
    });

    opts.push({
      label: '← Back to provider selection',
      value: 'back',
      key: 'back',
    });

    return opts;
  }, [supportsOAuth]);

  const handleSelect = useCallback(
    (value: AuthMethod) => {
      if (value === 'back') {
        onBack();
      } else {
        onSelect(value);
      }
    },
    [onBack, onSelect],
  );

  const providerDisplay = provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 3 of 5: Choose Authentication Method
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Foreground}>
          How would you like to authenticate with {providerDisplay}?
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color={Colors.AccentRed}>{error}</Text>
        </Box>
      )}

      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused={isFocused}
      />

      {apiKeyUrl && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Get API key at: {apiKeyUrl}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Use ↑↓ to navigate, Enter to select, Esc to skip
        </Text>
      </Box>
    </Box>
  );
};
