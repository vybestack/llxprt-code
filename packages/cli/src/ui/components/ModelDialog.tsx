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
  const [_error, _setError] = useState<string | null>(null);

  const [models, setModels] = useState<Array<{ label: string; value: string }>>(
    [],
  );

  const currentModel = config?.getModel() || 'gemini-2.5-pro';
  const [initialIndex, setInitialIndex] = useState(0);

  useEffect(() => {
    const loadModels = async () => {
      // Default models when API key not available or listing fails
      let modelList = [
        { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
        { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
      ];

      try {
        const client = await config?.getGeminiClient?.();
        if (client) {
          const fetched = await client.listAvailableModels();
          // Check for OAuth special marker or empty list
          if (fetched.length > 0 && fetched[0].name !== 'oauth-not-supported') {
            modelList = fetched.map((m) => ({
              label: m.displayName || m.name,
              value: m.name,
            }));
          }
        }
      } catch {
        /* ignore fall back to default */
      }
      // Sort models alphanumerically by label for consistent menu ordering
      modelList.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
      setModels(modelList);
      const idx = modelList.findIndex((m) => m.value === currentModel);
      setInitialIndex(idx >= 0 ? idx : 0);
      setLoading(false);
    };
    loadModels();
  }, [config, currentModel]);

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
      <Text bold color={Colors.Foreground}>
        Select Model
      </Text>
      <RadioButtonSelect
        items={models}
        initialIndex={initialIndex}
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
