/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
// import { LoopDetectionConfirmation } from './LoopDetectionConfirmation.js'; // TODO: Not yet ported from upstream
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { ShellConfirmationDialog } from './ShellConfirmationDialog.js';
import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
import { AuthInProgress } from './AuthInProgress.js';
import { AuthDialog } from './AuthDialog.js';
import { OAuthCodeDialog } from './OAuthCodeDialog.js';
import { EditorSettingsDialog } from './EditorSettingsDialog.js';
import { ProviderDialog } from './ProviderDialog.js';
import { ProviderModelDialog } from './ProviderModelDialog.js';
import { LoadProfileDialog } from './LoadProfileDialog.js';
import { ToolsDialog } from './ToolsDialog.js';
import { PrivacyNotice } from '../privacy/PrivacyNotice.js';
import { WorkspaceMigrationDialog } from './WorkspaceMigrationDialog.js';
// import { ProQuotaDialog } from './ProQuotaDialog.js'; // TODO: Not yet ported from upstream
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
// import { ModelDialog } from './ModelDialog.js'; // TODO: Not yet ported from upstream
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import process from 'node:process';
import { type UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
// import { IdeTrustChangeDialog } from './IdeTrustChangeDialog.js'; // TODO: Not yet ported from upstream

interface DialogManagerProps {
  addItem: UseHistoryManagerReturn['addItem'];
  terminalWidth: number;
  config: Config;
  settings: LoadedSettings;
}

// Props for DialogManager
export const DialogManager = ({
  addItem,
  terminalWidth,
  config,
  settings,
}: DialogManagerProps) => {
  const uiState = useUIState();
  const uiActions = useUIActions();
  const { constrainHeight, terminalHeight, mainAreaWidth } = uiState;
  // staticExtraHeight not yet implemented in LLxprt
  const staticExtraHeight = 0;

  // TODO: IdeTrustChangeDialog not yet ported from upstream
  // if (uiState.showIdeRestartPrompt) {
  //   return <IdeTrustChangeDialog reason={uiState.ideTrustRestartReason} />;
  // }
  if (uiState.showWorkspaceMigrationDialog) {
    return (
      <WorkspaceMigrationDialog
        workspaceExtensions={uiState.workspaceExtensions}
        onOpen={uiActions.onWorkspaceMigrationDialogOpen}
        onClose={uiActions.onWorkspaceMigrationDialogClose}
      />
    );
  }
  // TODO: ProQuotaDialog not yet ported from upstream
  // if (uiState.proQuotaRequest) {
  //   return (
  //     <ProQuotaDialog
  //       failedModel={uiState.proQuotaRequest.failedModel}
  //       fallbackModel={uiState.proQuotaRequest.fallbackModel}
  //       onChoice={uiActions.handleProQuotaChoice}
  //     />
  //   );
  // }
  if (uiState.shouldShowIdePrompt) {
    return (
      <IdeIntegrationNudge
        ide={uiState.currentIDE!}
        onComplete={uiActions.handleIdePromptComplete}
      />
    );
  }
  if (uiState.isFolderTrustDialogOpen) {
    return (
      <FolderTrustDialog
        onSelect={uiActions.handleFolderTrustSelect}
        isRestarting={uiState.isRestarting}
      />
    );
  }
  if (uiState.shellConfirmationRequest) {
    return (
      <ShellConfirmationDialog request={uiState.shellConfirmationRequest} />
    );
  }
  // TODO: LoopDetectionConfirmation not yet ported from upstream
  // if (uiState.loopDetectionConfirmationRequest) {
  //   return (
  //     <LoopDetectionConfirmation
  //       onComplete={uiState.loopDetectionConfirmationRequest.onComplete}
  //     />
  //   );
  // }
  if (uiState.confirmationRequest) {
    return (
      <ConsentPrompt
        prompt={uiState.confirmationRequest.prompt}
        onConfirm={uiState.confirmationRequest.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.confirmUpdateExtensionRequests.length > 0) {
    const request = uiState.confirmUpdateExtensionRequests[0];
    return (
      <ConsentPrompt
        prompt={request.prompt}
        onConfirm={request.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.isThemeDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.themeError && (
          <Box marginBottom={1}>
            <Text color={theme.status.error}>{uiState.themeError}</Text>
          </Box>
        )}
        <ThemeDialog
          onSelect={uiActions.handleThemeSelect}
          onHighlight={uiActions.handleThemeHighlight}
          settings={settings}
          availableTerminalHeight={
            constrainHeight ? terminalHeight - staticExtraHeight : undefined
          }
          terminalWidth={mainAreaWidth}
        />
      </Box>
    );
  }
  if (uiState.isSettingsDialogOpen) {
    return (
      <Box flexDirection="column">
        <SettingsDialog
          settings={settings}
          onSelect={() => uiActions.closeSettingsDialog()}
          onRestartRequest={() => process.exit(0)}
        />
      </Box>
    );
  }
  // TODO: ModelDialog not yet ported from upstream
  // if (uiState.isModelDialogOpen) {
  //   return <ModelDialog onClose={uiActions.closeModelDialog} />;
  // }
  if (uiState.isAuthenticating) {
    return <AuthInProgress onTimeout={uiActions.handleAuthTimeout} />;
  }
  if (uiState.isAuthDialogOpen) {
    return (
      <Box flexDirection="column">
        <AuthDialog
          onSelect={uiActions.handleAuthSelect}
          settings={settings}
          initialErrorMessage={uiState.authError}
        />
      </Box>
    );
  }
  if (uiState.isOAuthCodeDialogOpen) {
    const provider =
      (global as unknown as { __oauth_provider?: string }).__oauth_provider ||
      'unknown';
    return (
      <OAuthCodeDialog
        provider={provider}
        onClose={uiActions.handleOAuthCodeDialogClose}
        onSubmit={uiActions.handleOAuthCodeSubmit}
      />
    );
  }
  if (uiState.isEditorDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.editorError && (
          <Box marginBottom={1}>
            <Text color={theme.status.error}>{uiState.editorError}</Text>
          </Box>
        )}
        <EditorSettingsDialog
          onSelect={uiActions.handleEditorSelect}
          settings={settings}
          onExit={uiActions.exitEditorDialog}
        />
      </Box>
    );
  }
  if (uiState.isProviderDialogOpen) {
    return (
      <Box flexDirection="column">
        <ProviderDialog
          providers={uiState.providerOptions}
          currentProvider={uiState.selectedProvider}
          onSelect={uiActions.handleProviderSelect}
          onClose={uiActions.exitProviderDialog}
        />
      </Box>
    );
  }
  if (uiState.isProviderModelDialogOpen) {
    return (
      <Box flexDirection="column">
        <ProviderModelDialog
          models={uiState.providerModels}
          currentModel={uiState.currentModel}
          onSelect={uiActions.handleProviderModelChange}
          onClose={uiActions.exitProviderModelDialog}
        />
      </Box>
    );
  }
  if (uiState.isLoadProfileDialogOpen) {
    return (
      <Box flexDirection="column">
        <LoadProfileDialog
          profiles={uiState.profiles}
          onSelect={uiActions.handleProfileSelect}
          onClose={uiActions.exitLoadProfileDialog}
        />
      </Box>
    );
  }
  if (uiState.isToolsDialogOpen) {
    return (
      <Box flexDirection="column">
        <ToolsDialog
          tools={uiState.toolsDialogTools}
          action={uiState.toolsDialogAction}
          disabledTools={uiState.toolsDialogDisabledTools}
          onSelect={uiActions.handleToolsSelect}
          onClose={uiActions.exitToolsDialog}
        />
      </Box>
    );
  }
  if (uiState.showPrivacyNotice) {
    return (
      <PrivacyNotice
        onExit={() => uiActions.handlePrivacyNoticeExit()}
        config={config}
      />
    );
  }

  if (uiState.isPermissionsDialogOpen) {
    return (
      <PermissionsModifyTrustDialog
        onExit={uiActions.closePermissionsDialog}
        addItem={addItem}
      />
    );
  }

  return null;
};
