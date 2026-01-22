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

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  gemini: 'Google Gemini',
  codex: 'OpenAI Codex (ChatGPT Backend)',
  anthropic: 'Anthropic (Claude)',
  qwen: 'Qwen',
  synthetic: 'Synthetic (Testing)',
  zai: 'Zai',
  openai: 'OpenAI (GPT-4, etc.)',
  'openai-responses': 'OpenAI Responses API',
  openaivercel: 'OpenAI (Vercel AI SDK)',
  deepseek: 'DeepSeek',
};

// Preferred order for provider display
const PROVIDER_ORDER: string[] = [
  'gemini',
  'codex',
  'anthropic',
  'qwen',
  'synthetic',
  'zai',
  'openai',
  'openai-responses',
  'openaivercel',
  'deepseek',
];

interface ProviderSelectStepProps {
  providers: string[];
  onSelect: (providerId: string) => void;
  onSkip: () => void;
  isFocused?: boolean;
}

export const ProviderSelectStep: React.FC<ProviderSelectStepProps> = ({
  providers,
  onSelect,
  onSkip,
  isFocused = true,
}) => {
  const options: Array<RadioSelectItem<string>> = useMemo(() => {
    // Sort providers by preferred order
    const sortedProviders = [...providers].sort((a, b) => {
      const aIndex = PROVIDER_ORDER.indexOf(a);
      const bIndex = PROVIDER_ORDER.indexOf(b);
      // Providers not in the list go to the end
      const aOrder = aIndex === -1 ? PROVIDER_ORDER.length : aIndex;
      const bOrder = bIndex === -1 ? PROVIDER_ORDER.length : bIndex;
      return aOrder - bOrder;
    });

    const providerOptions = sortedProviders.map((provider) => ({
      label: PROVIDER_DISPLAY_NAMES[provider] || provider,
      value: provider,
      key: provider,
    }));

    // Add "configure manually" option
    providerOptions.push({
      label: 'Configure manually later',
      value: '__skip__',
      key: '__skip__',
    });

    return providerOptions;
  }, [providers]);

  const handleSelect = useCallback(
    (value: string) => {
      if (value === '__skip__') {
        onSkip();
      } else {
        onSelect(value);
      }
    },
    [onSkip, onSelect],
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 1 of 5: Choose Your AI Provider
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Foreground}>
          {"Select which AI provider you'd like to use:"}
        </Text>
      </Box>

      <RadioButtonSelect
        items={options}
        onSelect={handleSelect}
        isFocused={isFocused}
        maxItemsToShow={8}
      />

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Use ↑↓ to navigate, Enter to select, Esc to skip
        </Text>
      </Box>
    </Box>
  );
};
