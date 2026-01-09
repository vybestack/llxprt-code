/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { formatConfigSummary } from './utils.js';
import type { WizardState } from './types.js';

interface ProfileSuccessSummaryProps {
  state: WizardState;
  onClose: () => void;
  onLoadProfile?: (profileName: string) => void;
}

export const ProfileSuccessSummary: React.FC<ProfileSuccessSummaryProps> = ({
  state,
  onClose,
  onLoadProfile,
}) => {
  // Handle Escape key to close
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
      }
    },
    { isActive: true },
  );

  const handleSelect = useCallback(
    (value: string) => {
      if (value === 'load') {
        // Load the profile using the provided handler
        if (onLoadProfile && state.profileName) {
          onLoadProfile(state.profileName);
        }
        onClose();
      } else if (value === 'done') {
        onClose();
      }
    },
    [onClose, onLoadProfile, state.profileName],
  );

  const summary = formatConfigSummary(state);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentGreen}>
        ✓ Profile Created Successfully!
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text bold color={Colors.Foreground}>
        Profile: {state.profileName}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>Configuration Summary:</Text>
      {summary.split('\n').map((line, idx) => (
        <Text key={idx} color={Colors.Gray}>
          {line}
        </Text>
      ))}
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Gray}>
        You can load this profile with: /profile load {state.profileName}
      </Text>
      <Text color={Colors.Foreground}> </Text>

      <RadioButtonSelect
        items={[
          { label: 'Load this profile now', value: 'load', key: 'load' },
          { label: 'Return to llxprt', value: 'done', key: 'done' },
        ]}
        onSelect={handleSelect}
        isFocused={true}
      />
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Gray}>Esc Close</Text>
    </Box>
  );
};
