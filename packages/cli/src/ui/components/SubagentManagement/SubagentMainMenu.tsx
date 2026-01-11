/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { SubagentView, MENU_ACTIONS } from './types.js';

interface SubagentMainMenuProps {
  onSelect: (view: SubagentView) => void;
  isFocused?: boolean;
}

export const SubagentMainMenu: React.FC<SubagentMainMenuProps> = ({
  onSelect,
  isFocused = true,
}) => {
  const menuItems = MENU_ACTIONS.map((action) => ({
    label: `${action.label.padEnd(20)} - ${action.description}`,
    value: action.value,
    key: action.value,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Select an action:
        </Text>
      </Box>

      <RadioButtonSelect<SubagentView>
        items={menuItems}
        onSelect={onSelect}
        isFocused={isFocused}
        showNumbers={true}
        maxItemsToShow={10}
      />

      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press [ESC] to cancel</Text>
      </Box>
    </Box>
  );
};
