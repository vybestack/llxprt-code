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
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT-4, etc.)',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  'openai-responses': 'OpenAI Responses API',
  openaivercel: 'OpenAI (Vercel AI SDK)',
};

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
    const providerOptions = providers.map((provider) => ({
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
        <Text> </Text>
        <Text>{"Select which AI provider you'd like to use:"}</Text>
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
