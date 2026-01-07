/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { Box, Newline, Text } from 'ink';
import { Colors } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface ProviderInfo {
  displayName: string;
  tosUrl: string;
  privacyUrl: string;
  keyPoints: string[];
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  openai: {
    displayName: 'OpenAI',
    tosUrl: 'https://openai.com/policies/terms-of-use',
    privacyUrl: 'https://openai.com/policies/privacy-policy',
    keyPoints: [
      'API data is not used for training by default',
      '30-day data retention for abuse monitoring',
    ],
  },
  anthropic: {
    displayName: 'Anthropic',
    tosUrl: 'https://www.anthropic.com/legal/terms',
    privacyUrl: 'https://www.anthropic.com/legal/privacy',
    keyPoints: [
      'API data is not used for training',
      'Data retention for safety and legal compliance only',
    ],
  },
  fireworks: {
    displayName: 'Fireworks',
    tosUrl: 'https://fireworks.ai/terms-of-service',
    privacyUrl: 'https://fireworks.ai/privacy-policy',
    keyPoints: [
      'Data used only for service provision',
      'No model training on customer data',
    ],
  },
  openrouter: {
    displayName: 'OpenRouter',
    tosUrl: 'https://openrouter.ai/terms',
    privacyUrl: 'https://openrouter.ai/privacy',
    keyPoints: [
      'Acts as a proxy to multiple model providers',
      'Each underlying model may have additional terms',
    ],
  },
  local: {
    displayName: 'Local Model',
    tosUrl: '',
    privacyUrl: '',
    keyPoints: [
      'No data leaves your machine',
      'No external terms of service apply',
      'You control all data and privacy',
    ],
  },
};

// Aliases for provider name variations
const PROVIDER_ALIASES: Record<string, string> = {
  'lm-studio': 'local',
  lmstudio: 'local',
  ollama: 'local',
  llamacpp: 'local',
  'llama-cpp': 'local',
  'llama.cpp': 'local',
};

function getProviderInfo(providerName: string): ProviderInfo | null {
  const normalizedName = providerName.toLowerCase();
  const aliasedName = PROVIDER_ALIASES[normalizedName] ?? normalizedName;
  return PROVIDER_INFO[aliasedName] ?? null;
}

function formatProviderName(providerName: string): string {
  const info = getProviderInfo(providerName);
  if (info) {
    return info.displayName;
  }
  // Capitalize first letter for unknown providers
  return providerName.charAt(0).toUpperCase() + providerName.slice(1);
}

interface MultiProviderPrivacyNoticeProps {
  providerName: string;
  onExit: () => void;
}

export const MultiProviderPrivacyNotice = ({
  providerName,
  onExit,
}: MultiProviderPrivacyNoticeProps) => {
  const handleKeypress = useCallback(
    (key: { name?: string }) => {
      if (key.name === 'escape') {
        onExit();
      }
    },
    [onExit],
  );

  useKeypress(handleKeypress, { isActive: true });

  const providerInfo = getProviderInfo(providerName);
  const displayName = formatProviderName(providerName);
  const isLocal =
    providerInfo?.displayName === 'Local Model' ||
    PROVIDER_ALIASES[providerName.toLowerCase()] === 'local';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={Colors.AccentPurple}>
        LLxprt Code Privacy Notice
      </Text>
      <Newline />
      <Text color={Colors.Foreground}>
        LLxprt Code does{' '}
        <Text bold color={Colors.Foreground}>
          NOT
        </Text>{' '}
        collect any telemetry or usage data.
      </Text>
      <Text color={Colors.Foreground}>
        All data handling is governed by your chosen AI provider&apos;s
        policies.
      </Text>
      <Newline />

      <Text bold color={Colors.AccentCyan}>
        Active Provider: {displayName}
      </Text>
      <Newline />

      {isLocal ? (
        <Box flexDirection="column">
          <Text color={Colors.AccentGreen}>
            Local models keep all data on your machine.
          </Text>
          {providerInfo?.keyPoints.map((point, index) => (
            <Text key={index} color={Colors.Foreground}>
              {'  '}- {point}
            </Text>
          ))}
        </Box>
      ) : providerInfo ? (
        <Box flexDirection="column">
          <Text color={Colors.Foreground}>
            <Text color={Colors.AccentBlue}>[Terms]</Text> {providerInfo.tosUrl}
          </Text>
          <Text color={Colors.Foreground}>
            <Text color={Colors.AccentGreen}>[Privacy]</Text>{' '}
            {providerInfo.privacyUrl}
          </Text>
          <Newline />
          <Text bold color={Colors.Foreground}>
            Key points:
          </Text>
          {providerInfo.keyPoints.map((point, index) => (
            <Text key={index} color={Colors.Foreground}>
              {'  '}- {point}
            </Text>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={Colors.Foreground}>
            Please refer to {displayName}&apos;s terms of service and privacy
            policy
          </Text>
          <Text color={Colors.Foreground}>
            for information about how your data is handled.
          </Text>
        </Box>
      )}

      <Newline />
      <Text color={Colors.Gray}>
        For full provider information, see: docs/tos-privacy.md
      </Text>
      <Newline />
      <Text color={Colors.Gray}>Press Esc to exit.</Text>
    </Box>
  );
};
