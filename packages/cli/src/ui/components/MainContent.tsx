/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Static } from 'ink';
import { HistoryItemDisplay } from './HistoryItemDisplay.js';
import { ShowMoreLines } from './ShowMoreLines.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useAppContext } from '../contexts/AppContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { AppHeader } from './AppHeader.js';

export const MainContent = () => {
  const { version } = useAppContext();
  const uiState = useUIState();
  const config = useConfig();
  const {
    pendingHistoryItems,
    mainAreaWidth,
    terminalHeight,
    availableTerminalHeight,
  } = uiState;

  const staticAreaMaxItemHeight = Math.max(terminalHeight * 4, 100);

  return (
    <>
      <Static
        key={uiState.staticKey}
        items={[
          <AppHeader key="app-header" version={version} />,
          ...uiState.history.map((h) => (
            <HistoryItemDisplay
              terminalWidth={mainAreaWidth}
              availableTerminalHeight={staticAreaMaxItemHeight}
              key={h.id}
              item={h}
              isPending={false}
              slashCommands={uiState.slashCommands}
              config={config}
            />
          )),
        ]}
      >
        {(item) => item}
      </Static>
      <OverflowProvider>
        <Box flexDirection="column">
          {pendingHistoryItems.map((item, i) => (
            <HistoryItemDisplay
              key={i}
              availableTerminalHeight={
                uiState.constrainHeight ? availableTerminalHeight : undefined
              }
              terminalWidth={mainAreaWidth}
              item={{ ...item, id: 0 }}
              isPending={true}
              isFocused={!uiState.isEditorDialogOpen}
              activeShellPtyId={uiState.activePtyId}
              config={config}
            />
          ))}
          <ShowMoreLines constrainHeight={uiState.constrainHeight} />
        </Box>
      </OverflowProvider>
    </>
  );
};
