/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import type { Config } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { Colors } from '../colors.js';

// Dialog components
import { WorkspaceMigrationDialog } from './WorkspaceMigrationDialog.js';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { ShellConfirmationDialog } from './ShellConfirmationDialog.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
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
import { DetailedMessagesDisplay } from './DetailedMessagesDisplay.js';
import { ShowMoreLines } from './ShowMoreLines.js';

interface DialogManagerProps {
  config: Config;
  settings: LoadedSettings;
  availableTerminalHeight: number | undefined;
  mainAreaWidth: number;
  inputWidth: number;
  debugConsoleMaxHeight: number;
  constrainHeight: boolean;
}

export const DialogManager = ({
  config,
  settings,
  availableTerminalHeight,
  mainAreaWidth,
  inputWidth,
  debugConsoleMaxHeight,
  constrainHeight,
}: DialogManagerProps) => {
  const uiState = useUIState();
  const uiActions = useUIActions();

  // Workspace migration dialog
  if (uiState.showWorkspaceMigrationDialog) {
    return (
      <WorkspaceMigrationDialog
        workspaceExtensions={uiState.workspaceExtensions}
        onOpen={uiActions.onWorkspaceMigrationDialogOpen}
        onClose={uiActions.onWorkspaceMigrationDialogClose}
      />
    );
  }

  // IDE integration nudge
  if (uiState.shouldShowIdePrompt && uiState.currentIDE) {
    return (
      <IdeIntegrationNudge
        ide={
          { displayName: uiState.currentIDE } as Parameters<
            typeof IdeIntegrationNudge
          >[0]['ide']
        }
        onComplete={uiActions.handleIdePromptComplete}
      />
    );
  }

  // IDE restart prompt
  if (uiState.showIdeRestartPrompt) {
    return (
      <Box borderStyle="round" borderColor={Colors.AccentYellow} paddingX={1}>
        <Text color={Colors.AccentYellow}>
          Workspace trust has changed. Press &apos;r&apos; to restart Gemini to
          apply the changes.
        </Text>
      </Box>
    );
  }

  // Folder trust dialog
  if (uiState.isFolderTrustDialogOpen) {
    return (
      <FolderTrustDialog
        onSelect={uiActions.handleFolderTrustSelect}
        isRestarting={uiState.isRestarting}
      />
    );
  }

  // Shell confirmation dialog
  if (uiState.shellConfirmationRequest) {
    return (
      <ShellConfirmationDialog request={uiState.shellConfirmationRequest} />
    );
  }

  // Generic confirmation dialog
  if (uiState.confirmationRequest) {
    return (
      <Box flexDirection="column">
        {uiState.confirmationRequest.prompt}
        <Box paddingY={1}>
          <RadioButtonSelect
            isFocused={!!uiState.confirmationRequest}
            items={[
              { label: 'Yes', value: true },
              { label: 'No', value: false },
            ]}
            onSelect={uiActions.handleConfirmationSelect}
          />
        </Box>
      </Box>
    );
  }

  // Theme dialog
  if (uiState.isThemeDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.themeError && (
          <Box marginBottom={1}>
            <Text color={Colors.AccentRed}>{uiState.themeError}</Text>
          </Box>
        )}
        <ThemeDialog
          onSelect={uiActions.handleThemeSelect}
          onHighlight={uiActions.handleThemeHighlight}
          settings={settings}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={mainAreaWidth}
        />
      </Box>
    );
  }

  // Settings dialog
  if (uiState.isSettingsDialogOpen) {
    return (
      <Box flexDirection="column">
        <SettingsDialog
          settings={settings}
          onSelect={uiActions.closeSettingsDialog}
          onRestartRequest={uiActions.handleSettingsRestart}
        />
      </Box>
    );
  }

  // Auth in progress
  if (uiState.isAuthenticating) {
    return (
      <>
        <AuthInProgress onTimeout={uiActions.handleAuthTimeout} />
        {uiState.showErrorDetails && (
          <OverflowProvider>
            <Box flexDirection="column">
              <DetailedMessagesDisplay
                messages={uiState.consoleMessages}
                maxHeight={constrainHeight ? debugConsoleMaxHeight : undefined}
                width={inputWidth}
              />
              <ShowMoreLines constrainHeight={constrainHeight} />
            </Box>
          </OverflowProvider>
        )}
      </>
    );
  }

  // Auth dialog
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

  // OAuth code dialog
  if (uiState.isOAuthCodeDialogOpen) {
    return (
      <Box flexDirection="column">
        <OAuthCodeDialog
          provider={
            ((global as Record<string, unknown>).__oauth_provider as string) ||
            'anthropic'
          }
          onClose={uiActions.handleOAuthCodeDialogClose}
          onSubmit={uiActions.handleOAuthCodeSubmit}
        />
      </Box>
    );
  }

  // Editor settings dialog
  if (uiState.isEditorDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.editorError && (
          <Box marginBottom={1}>
            <Text color={Colors.AccentRed}>{uiState.editorError}</Text>
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

  // Provider dialog
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

  // Provider model dialog
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

  // Load profile dialog
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

  // Tools dialog
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

  // Privacy notice
  if (uiState.showPrivacyNotice) {
    return (
      <PrivacyNotice
        onExit={uiActions.handlePrivacyNoticeExit}
        config={config}
      />
    );
  }

  // No dialog - shouldn't reach here but return null for safety
  return null;
};
