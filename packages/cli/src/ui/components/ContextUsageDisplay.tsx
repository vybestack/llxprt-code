/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { tokenLimit } from '@vybestack/llxprt-code-core';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
  contextLimit,
}: {
  promptTokenCount: number;
  model: string;
  contextLimit?: number;
}) => {
  const limit = tokenLimit(model, contextLimit);
  const percentage = promptTokenCount / limit;
  const remainingPercentage = (1 - percentage) * 100;

  // Use semantic colors based on how much context is left
  let color: string;
  if (remainingPercentage < 10) {
    color = SemanticColors.status.error; // Very low context
  } else if (remainingPercentage < 25) {
    color = SemanticColors.status.warning; // Low context
  } else {
    color = SemanticColors.text.secondary; // Normal context
  }

  return (
    <Text color={color}>({remainingPercentage.toFixed(0)}% context left)</Text>
  );
};
