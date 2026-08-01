/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { TrustRule } from '../../config/trustedFolders.js';
import { buildTrustRuleOptions } from '../trustDialogHelpers.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

interface PermissionsTrustRulesListProps {
  rules: readonly TrustRule[];
  onSelect: (rulePath: string) => void;
  /** The dialog owns focus, so that it can be withdrawn during a write. */
  isFocused: boolean;
}

/**
 * Lists every configured trust rule so any of them can be revisited without
 * restarting the CLI in that directory.
 */
export const PermissionsTrustRulesList: React.FC<
  PermissionsTrustRulesListProps
> = ({ rules, onSelect, isFocused }) => (
  <Box flexDirection="column">
    <Box
      flexDirection="column"
      borderStyle={getBorderStyle('round')}
      borderColor={Colors.Gray}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Text color={Colors.Foreground} bold>
        Existing trust rules
      </Text>
      {rules.length === 0 ? (
        <Box marginTop={1}>
          <Text color={Colors.Comment}>
            No folder trust rules are configured yet.
          </Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={Colors.Foreground}>Select a folder to change:</Text>
          <RadioButtonSelect
            items={buildTrustRuleOptions(rules)}
            initialIndex={0}
            onSelect={onSelect}
            isFocused={isFocused}
          />
        </Box>
      )}
    </Box>
    <Box marginLeft={1} marginTop={1}>
      <Text color={Colors.Gray}>
        {rules.length === 0
          ? '(Escape to go back)'
          : '(Enter to select, Escape to go back)'}
      </Text>
    </Box>
  </Box>
);
