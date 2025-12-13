/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Load Balancer Stats Display Component
 * Issue #489 Phase 8
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

export const LBStatsDisplay: React.FC = () => {
  const { getCliProviderManager } = useRuntimeApi();
  const providerManager = getCliProviderManager();

  if (!providerManager) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text>Provider manager not available</Text>
      </Box>
    );
  }

  const currentProvider = providerManager.getActiveProvider();

  if (!currentProvider || currentProvider.name !== 'load-balancer') {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          No load balancer profile active. Use /profile load to activate a load
          balancer profile.
        </Text>
      </Box>
    );
  }

  // Check if the provider has getStats method (will be added in Phases 1-5)
  const getStats = (currentProvider as { getStats?: () => unknown }).getStats;

  if (!getStats) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          Load balancer statistics not yet implemented (requires Phases 1-5 of
          Issue #489).
        </Text>
      </Box>
    );
  }

  // Once Phases 1-5 are complete, this will display actual stats
  // For now, just show that we detected a load balancer
  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <Text bold color={Colors.AccentPurple}>
        Load Balancer Statistics
      </Text>
      <Box height={1} />
      <Text color={Colors.Foreground}>
        Load balancer profile active. Full statistics will be available after
        Phases 1-5 implementation.
      </Text>
    </Box>
  );
};
