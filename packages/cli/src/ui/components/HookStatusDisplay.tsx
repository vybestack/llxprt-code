/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ActiveHook } from '../types.js';

interface HookStatusDisplayProps {
  activeHooks: ActiveHook[];
  color?: string;
}

/**
 * Component to display actively executing hooks.
 * Shows "Executing Hook: {name}" when hooks are running.
 */
export const HookStatusDisplay: React.FC<HookStatusDisplayProps> = ({
  activeHooks,
  color = 'yellow',
}) => {
  if (activeHooks.length === 0) {
    return null;
  }

  const hookNames = activeHooks
    .map((h) => {
      let name = h.name;
      if (h.index !== undefined && h.total !== undefined) {
        name += ` (${h.index}/${h.total})`;
      }
      return name;
    })
    .join(', ');

  const label = activeHooks.length === 1 ? 'Executing Hook' : 'Executing Hooks';

  return (
    <Box>
      <Text color={color}>
        {label}: {hookNames}
      </Text>
    </Box>
  );
};
