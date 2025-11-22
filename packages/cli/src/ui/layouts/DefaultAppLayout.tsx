/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
import { DialogManager } from '../components/DialogManager.js';
import { Composer } from '../components/Composer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useHistory } from '../hooks/useHistoryManager.js';

export const DefaultAppLayout: React.FC = () => {
  const uiState = useUIState();
  const { config, settings } = uiState;
  const { addItem } = useHistory({ maxItems: 1000, maxBytes: 1000000 });

  // Check if any dialog is visible
  const dialogsVisible =
    uiState.isThemeDialogOpen ||
    uiState.isSettingsDialogOpen ||
    uiState.isAuthDialogOpen ||
    uiState.isEditorDialogOpen ||
    uiState.isProviderDialogOpen ||
    uiState.isProviderModelDialogOpen ||
    uiState.isLoadProfileDialogOpen ||
    uiState.isToolsDialogOpen ||
    uiState.isFolderTrustDialogOpen ||
    uiState.showWorkspaceMigrationDialog ||
    uiState.showPrivacyNotice ||
    uiState.isOAuthCodeDialogOpen ||
    uiState.isPermissionsDialogOpen ||
    uiState.shellConfirmationRequest !== null ||
    uiState.confirmationRequest !== null ||
    uiState.confirmUpdateExtensionRequests.length > 0;

  return (
    <Box flexDirection="column" width="90%">
      {/* History display */}
      <Box flexDirection="column" marginBottom={1}>
        {uiState.history.map((item) => (
          <HistoryItemDisplay
            key={item.id}
            item={item}
            terminalWidth={uiState.terminalWidth}
            isPending={false}
            config={config}
          />
        ))}
        {uiState.pendingHistoryItems.map((item, index) => {
          // Convert HistoryItemWithoutId to HistoryItem by adding an id
          const pendingAsHistoryItem = { ...item, id: -index - 1 };
          return (
            <HistoryItemDisplay
              key={`pending-${index}`}
              item={pendingAsHistoryItem}
              terminalWidth={uiState.terminalWidth}
              isPending={true}
              config={config}
            />
          );
        })}
      </Box>

      {/* Dialog or Composer */}
      {dialogsVisible ? (
        <DialogManager
          terminalWidth={uiState.terminalWidth}
          addItem={addItem}
          config={config}
          settings={settings}
        />
      ) : (
        <Composer config={config} settings={settings} />
      )}
    </Box>
  );
};
