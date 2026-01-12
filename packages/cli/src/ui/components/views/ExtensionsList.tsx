/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { useUIState } from '../../contexts/UIStateContext.js';
import { ExtensionUpdateState } from '../../state/extensions.js';
import { Colors } from '../../colors.js';

export const ExtensionsList = () => {
  const { commandContext } = useUIState();
  const extensionsUpdateState = commandContext.ui.extensionsUpdateState;
  const allExtensions = commandContext.services.config!.getExtensions();

  if (allExtensions.length === 0) {
    return <Text color={Colors.Foreground}>No extensions installed.</Text>;
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text color={Colors.Foreground}>Installed extensions:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {allExtensions.map((ext) => {
          const state = extensionsUpdateState.get(ext.name);
          const isActive = ext.isActive;
          const activeString = isActive ? 'active' : 'disabled';
          const activeColor = isActive ? Colors.AccentGreen : Colors.DimComment;

          let stateColor: string = Colors.DimComment;
          const stateText = state || 'unknown state';

          switch (state) {
            case ExtensionUpdateState.CHECKING_FOR_UPDATES:
            case ExtensionUpdateState.UPDATING:
              stateColor = Colors.AccentCyan;
              break;
            case ExtensionUpdateState.UPDATE_AVAILABLE:
            case ExtensionUpdateState.UPDATED_NEEDS_RESTART:
              stateColor = Colors.AccentYellow;
              break;
            case ExtensionUpdateState.ERROR:
              stateColor = Colors.AccentRed;
              break;
            case ExtensionUpdateState.UP_TO_DATE:
            case ExtensionUpdateState.NOT_UPDATABLE:
              stateColor = Colors.AccentGreen;
              break;
            default:
              // No need to log error for undefined state - we show 'unknown state'
              break;
          }

          return (
            <Box key={ext.name}>
              <Text color={Colors.Foreground}>
                <Text color={Colors.AccentCyan}>{`${ext.name} (v${ext.version})`}</Text>
                <Text color={activeColor}>{` - ${activeString}`}</Text>
                {<Text color={stateColor}>{` (${stateText})`}</Text>}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
