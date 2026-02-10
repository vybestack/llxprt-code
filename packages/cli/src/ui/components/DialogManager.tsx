/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { useCallback, useMemo } from 'react';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type {
  HydratedModel,
  Config,
  Profile,
} from '@vybestack/llxprt-code-core';
// import { LoopDetectionConfirmation } from './LoopDetectionConfirmation.js'; // TODO: Not yet ported from upstream
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { WelcomeDialog } from './WelcomeOnboarding/WelcomeDialog.js';
import { ShellConfirmationDialog } from './ShellConfirmationDialog.js';
import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
import { AuthDialog } from './AuthDialog.js';
import { OAuthCodeDialog } from './OAuthCodeDialog.js';
import { EditorSettingsDialog } from './EditorSettingsDialog.js';
import { ProviderDialog } from './ProviderDialog.js';
import { LoadProfileDialog } from './LoadProfileDialog.js';
import { ProfileCreateWizard } from './ProfileCreateWizard/index.js';
import { ProfileListDialog } from './ProfileListDialog.js';
import { ProfileDetailDialog } from './ProfileDetailDialog.js';
import { ProfileInlineEditor } from './ProfileInlineEditor.js';
import { ToolsDialog } from './ToolsDialog.js';
import { PrivacyNotice } from '../privacy/PrivacyNotice.js';
import { WorkspaceMigrationDialog } from './WorkspaceMigrationDialog.js';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import { LoggingDialog } from './LoggingDialog.js';
import { SubagentManagerDialog } from './SubagentManagement/index.js';
import { SubagentView } from './SubagentManagement/types.js';
import { ModelsDialog } from './ModelDialog.js';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import type { LoadedSettings } from '../../config/settings.js';
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
  const runtime = useRuntimeApi();
  const { constrainHeight, terminalHeight, mainAreaWidth } = uiState;
  // staticExtraHeight not yet implemented in LLxprt
  const staticExtraHeight = 0;

  // Get current provider for ModelsDialog
  const currentProvider = useMemo(() => {
    try {
      return runtime.getActiveProviderName() || null;
    } catch {
      return null;
    }
  }, [runtime]);

  const handlePrivacyNoticeExit = useCallback(() => {
    uiActions.handlePrivacyNoticeExit();
  }, [uiActions]);

  // Handler for ModelsDialog selection
  const handleModelsDialogSelect = useCallback(
    async (model: HydratedModel) => {
      try {
        const selectedProvider = model.provider;

        // Check if we need to switch providers
        // Switch if: provider differs OR no current provider set
        if (selectedProvider !== currentProvider) {
          // 1. Switch provider first
          const switchResult = await runtime.switchActiveProvider(
            selectedProvider,
            { addItem },
          );

          // 2. Build messages in correct order
          const messages: string[] = [];

          // Provider switch message
          messages.push(
            currentProvider
              ? `Switched from ${currentProvider} to ${switchResult.nextProvider}`
              : `Switched to ${switchResult.nextProvider}`,
          );

          // Base URL message (extract from switchResult)
          const baseUrlMsg = (switchResult.infoMessages ?? []).find(
            (m) => m?.includes('Base URL') || m?.includes('base URL'),
          );
          if (baseUrlMsg) messages.push(baseUrlMsg);

          // Set the selected model (override provider's default)
          await runtime.setActiveModel(model.id);

          // Model message with user's selected model
          messages.push(
            `Active model is '${model.id}' for provider '${selectedProvider}'.`,
          );

          // /key reminder (if not gemini)
          if (selectedProvider !== 'gemini') {
            messages.push('Use /key to set API key if needed.');
          }

          // Show all messages
          for (const msg of messages) {
            addItem({ type: 'info', text: msg }, Date.now());
          }
        } else {
          // Same provider — just set model
          const result = await runtime.setActiveModel(model.id);
          addItem(
            {
              type: 'info',
              text: `Active model is '${result.nextModel}' for provider '${result.providerName}'.`,
            },
            Date.now(),
          );
        }
      } catch (e) {
        const status = runtime.getActiveProviderStatus();
        addItem(
          {
            type: 'error',
            text: `Failed to switch model for provider '${status.providerName ?? 'unknown'}': ${e instanceof Error ? e.message : String(e)}`,
          },
          Date.now(),
        );
      }
      uiActions.closeModelsDialog();
    },
    [runtime, addItem, uiActions, currentProvider],
  );

  // TODO: IdeTrustChangeDialog not yet ported from upstream
  // if (uiState.showIdeRestartPrompt) {
  //   return <IdeTrustChangeDialog reason={uiState.ideTrustRestartReason} />;
  // }
  if (uiState.showWorkspaceMigrationDialog) {
    return (
      <WorkspaceMigrationDialog
        workspaceExtensions={uiState.workspaceGeminiCLIExtensions}
        onOpen={uiActions.onWorkspaceMigrationDialogOpen}
        onClose={uiActions.onWorkspaceMigrationDialogClose}
      />
    );
  }
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
  if (uiState.isWelcomeDialogOpen) {
    return (
      <WelcomeDialog
        state={uiState.welcomeState}
        actions={uiActions.welcomeActions}
        availableProviders={uiState.welcomeAvailableProviders}
        availableModels={uiState.welcomeAvailableModels}
        triggerAuth={uiActions.triggerWelcomeAuth}
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
  if (uiState.confirmUpdateGeminiCLIExtensionRequests.length > 0) {
    const request = uiState.confirmUpdateGeminiCLIExtensionRequests[0];
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
          onSelect={uiActions.closeSettingsDialog}
          onRestartRequest={uiActions.handleSettingsRestart}
          config={config}
        />
      </Box>
    );
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
  if (uiState.isCreateProfileDialogOpen) {
    return (
      <Box flexDirection="column">
        <ProfileCreateWizard
          onClose={uiActions.exitCreateProfileDialog}
          onLoadProfile={uiActions.handleProfileSelect}
          availableProviders={uiState.providerOptions}
        />
      </Box>
    );
  }
  if (uiState.isProfileListDialogOpen) {
    return (
      <Box flexDirection="column">
        <ProfileListDialog
          profiles={uiState.profileListItems}
          onSelect={uiActions.loadProfileFromDetail}
          onClose={uiActions.closeProfileListDialog}
          onViewDetail={uiActions.viewProfileDetail}
          isLoading={uiState.profileDialogLoading}
          defaultProfileName={uiState.defaultProfileName ?? undefined}
          activeProfileName={uiState.activeProfileName ?? undefined}
        />
      </Box>
    );
  }
  if (uiState.isProfileDetailDialogOpen) {
    return (
      <Box flexDirection="column">
        <ProfileDetailDialog
          profileName={uiState.selectedProfileName ?? ''}
          profile={uiState.selectedProfileData as Profile | null}
          onClose={uiActions.closeProfileDetailDialog}
          onLoad={uiActions.loadProfileFromDetail}
          onDelete={uiActions.deleteProfileFromDetail}
          onSetDefault={uiActions.setProfileAsDefault}
          onEdit={uiActions.openProfileEditor}
          isLoading={uiState.profileDialogLoading}
          isDefault={uiState.selectedProfileName === uiState.defaultProfileName}
          isActive={uiState.selectedProfileName === uiState.activeProfileName}
          error={uiState.profileDialogError ?? undefined}
        />
      </Box>
    );
  }
  if (uiState.isProfileEditorDialogOpen && uiState.selectedProfileData) {
    return (
      <Box flexDirection="column">
        <ProfileInlineEditor
          profileName={uiState.selectedProfileName ?? ''}
          profile={uiState.selectedProfileData as Profile}
          onSave={
            uiActions.saveProfileFromEditor as (
              name: string,
              profile: Profile,
            ) => void
          }
          onCancel={uiActions.closeProfileEditor}
          error={uiState.profileDialogError ?? undefined}
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
    return <PrivacyNotice onExit={handlePrivacyNoticeExit} config={config} />;
  }

  if (uiState.isPermissionsDialogOpen) {
    return (
      <PermissionsModifyTrustDialog
        onExit={uiActions.closePermissionsDialog}
        addItem={addItem}
      />
    );
  }

  if (uiState.isLoggingDialogOpen) {
    return (
      <LoggingDialog
        entries={
          (uiState.loggingDialogData?.entries || []) as Array<{
            timestamp: string;
            type: 'request' | 'response' | 'tool_call';
            provider: string;
            model?: string;
            conversationId?: string;
            messages?: Array<{ role: string; content: string }>;
            response?: string;
            tokens?: { input?: number; output?: number };
            error?: string;
            tool?: string;
            duration?: number;
            success?: boolean;
            gitStats?: {
              linesAdded: number;
              linesRemoved: number;
              filesChanged: number;
            };
          }>
        }
        onClose={uiActions.closeLoggingDialog}
      />
    );
  }

  if (uiState.isSubagentDialogOpen) {
    return (
      <SubagentManagerDialog
        onClose={uiActions.closeSubagentDialog}
        initialView={uiState.subagentDialogInitialView ?? SubagentView.MENU}
        initialSubagentName={uiState.subagentDialogInitialName}
      />
    );
  }

  if (uiState.isModelsDialogOpen) {
    return (
      <Box flexDirection="column">
        <ModelsDialog
          onSelect={handleModelsDialogSelect}
          onClose={uiActions.closeModelsDialog}
          initialSearch={uiState.modelsDialogData?.initialSearch}
          initialFilters={uiState.modelsDialogData?.initialFilters}
          includeDeprecated={uiState.modelsDialogData?.includeDeprecated}
          currentProvider={currentProvider}
          initialProviderFilter={uiState.modelsDialogData?.providerOverride}
          showAllProviders={uiState.modelsDialogData?.showAllProviders}
        />
      </Box>
    );
  }

  return null;
};
