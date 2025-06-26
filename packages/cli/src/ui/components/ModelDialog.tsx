/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { Colors } from '../colors.js';
import { Config } from '@google/gemini-cli-core';

interface ModelDialogProps {
  config: Config | null;
  onClose: () => void;
  onModelSelected: (model: string) => void;
}

export const ModelDialog: React.FC<ModelDialogProps> = ({
  config,
  onClose,
  onModelSelected,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hardcoded models for OAuth users
  const models = [
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
  ];

  const currentModel = config?.getModel() || 'gemini-2.5-pro';
  const initialIndex = models.findIndex(m => m.value === currentModel);

  useEffect(() => {
    // Simulate loading
    setTimeout(() => setLoading(false), 100);
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  const handleModelSelect = (model: string) => {
    onModelSelected(model);
    onClose();
  };

  if (loading) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={Colors.Foreground}
        paddingX={2}
        paddingY={1}
      >
        <Text color={Colors.Foreground}>Loading available models...</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={Colors.Foreground}>Select Model</Text>
      <RadioButtonSelect
        items={models}
        initialIndex={initialIndex >= 0 ? initialIndex : 0}
        onSelect={handleModelSelect}
        isFocused={true}
      />
      <Box marginTop={1}>
        <Text color={Colors.Gray}>(Use Enter to select, Esc to cancel)</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.AccentYellow}>
          Note: OAuth authentication supports only these two models
        </Text>
      </Box>
    </Box>
  );
};