/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure dialog renderer helpers shared by DialogManager. Each helper maps one
 * dialog kind to its component; all data arrives through parameters so these
 * stay hook-free and trivially testable.
 */

import type { CliUiRuntime } from '../cliUiRuntime.js';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
import type {
  ContinueTarget,
  HydratedModel,
} from '@vybestack/llxprt-code-core';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import type { ModelInfo, WelcomeState } from '../hooks/useWelcomeOnboarding.js';
import type { ProfileListItem } from '../stores/settings/settingsStore.js';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import type {
  PerformResumeResult,
  ResumeContext,
} from '../../services/performResume.js';
import { firstNonEmptyString } from '../../utils/coalesce.js';
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { WelcomeDialog } from './WelcomeOnboarding/WelcomeDialog.js';
import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { WorkspaceMigrationDialog } from './WorkspaceMigrationDialog.js';
import { AuthDialog } from './AuthDialog.js';
import { OAuthCodeDialog } from './OAuthCodeDialog.js';
import { getPendingOAuthProvider } from '../oauthGlobalState.js';
import { EditorSettingsDialog } from './EditorSettingsDialog.js';
import { ProviderDialog } from './ProviderDialog.js';
import { LoadProfileDialog } from './LoadProfileDialog.js';
import { ProfileCreateWizard } from './ProfileCreateWizard/index.js';
import { ProfileListDialog } from './ProfileListDialog.js';
import { ProfileDetailDialog } from './ProfileDetailDialog.js';
import { ProfileInlineEditor } from './ProfileInlineEditor.js';
import { ToolsDialog } from './ToolsDialog.js';
import { ModelsDialog } from './ModelDialog.js';
import type { ModelsDialogData } from '../commands/types.js';
import type { AppCommands } from '../contexts/AppCommandsContext.js';
import type { LoadedSettings, SettingScope } from '../../config/settings.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type {
  ListDialogKind,
  DialogRequest,
} from '../stores/dialog/dialogStore.js';
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 */
import { SessionBrowserDialog } from './SessionBrowserDialog.js';

/**
 * Dialog open-time data, read from the settings/profile store through narrow
 * selectors at the hook-legal site so the pure render helpers stay pure.
 */
export interface DialogData {
  themeError: string | null;
  editorError: string | null;
  welcomeState: WelcomeState;
  welcomeAvailableProviders: string[];
  welcomeAvailableModels: ModelInfo[];
  authError: string | null;
  providerOptions: string[];
  selectedProvider: string;
  profiles: string[];
  createProfileProviders: string[];
  profileListItems: ProfileListItem[];
  profileDialogLoading: boolean;
  profileDialogError: string | null;
  selectedProfileName: string | null;
  selectedProfileData: Profile | null;
  defaultProfileName: string | null;
  activeProfileName: string | null;
  toolsDialogTools: ToolInfo[];
  toolsDialogDisabledTools: string[];
}

export interface StoreDialogRenderContext {
  uiState: DialogData;
  uiActions: AppCommands;
  settings: LoadedSettings;
  config: CliUiRuntime;
  addItem: UseHistoryManagerReturn['addItem'];
}

/**
 * Early dialogs, rendered from the active DialogStore entry. These kinds
 * outrank every body dialog in DIALOG_PRIORITY, so the switch mirrors the
 * former renderEarlyDialogs if-chain exactly.
 */
export function renderEarlyStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  terminalWidth: number,
  close: (kind: ListDialogKind) => void,
) {
  const { uiState, uiActions, config } = ctx;
  switch (active.kind) {
    case 'workspaceMigration':
      return (
        <WorkspaceMigrationDialog
          workspaceExtensions={active.payload.extensions}
          onOpen={uiActions.onWorkspaceMigrationDialogOpen}
          onClose={() => close('workspaceMigration')}
        />
      );
    case 'idePrompt':
      return (
        <IdeIntegrationNudge
          ide={active.payload.ide}
          onComplete={uiActions.handleIdePromptComplete}
        />
      );
    case 'folderTrust':
      return (
        <FolderTrustDialog
          workingDirectory={config.getWorkingDir()}
          onSelect={uiActions.handleFolderTrustSelect}
        />
      );
    case 'welcome':
      return (
        <WelcomeDialog
          state={uiState.welcomeState}
          actions={uiActions.welcomeActions}
          availableProviders={uiState.welcomeAvailableProviders}
          availableModels={uiState.welcomeAvailableModels}
          triggerAuth={uiActions.triggerWelcomeAuth}
        />
      );
    case 'confirmation':
    case 'extensionUpdateConfirm':
      return (
        <ConsentPrompt
          prompt={active.payload.prompt}
          onConfirm={active.payload.onConfirm}
          terminalWidth={terminalWidth}
        />
      );
    default:
      return undefined;
  }
}

export function renderThemeDialog(
  error: string | null,
  uiActions: Pick<AppCommands, 'handleThemeSelect' | 'handleThemeHighlight'>,
  settings: LoadedSettings,
  constrainHeight: boolean,
  terminalHeight: number,
  staticExtraHeight: number,
  mainAreaWidth: number,
) {
  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>{error}</Text>
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

export function renderAuthDialog(
  uiState: DialogData,
  settings: LoadedSettings,
  handleAuthSelect: (method: string | undefined, scope: SettingScope) => void,
) {
  return (
    <Box flexDirection="column">
      <AuthDialog
        onSelect={handleAuthSelect}
        settings={settings}
        initialErrorMessage={uiState.authError}
      />
    </Box>
  );
}

export function renderOAuthCodeDialog(
  uiActions: AppCommands,
  handleOAuthCodeSubmit: (code: string) => void,
) {
  const provider = firstNonEmptyString(getPendingOAuthProvider(), 'unknown');
  return (
    <OAuthCodeDialog
      provider={provider}
      onClose={uiActions.handleOAuthCodeDialogClose}
      onSubmit={handleOAuthCodeSubmit}
    />
  );
}

export function renderEditorDialog(
  error: string | null,
  uiActions: Pick<AppCommands, 'handleEditorSelect'>,
  settings: LoadedSettings,
  onExit: () => void,
) {
  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}
      <EditorSettingsDialog
        onSelect={uiActions.handleEditorSelect}
        settings={settings}
        onExit={onExit}
      />
    </Box>
  );
}

export function renderProviderDialog(
  uiState: DialogData,
  handleProviderSelect: (provider: string) => void,
  onClose: () => void,
) {
  return (
    <Box flexDirection="column">
      <ProviderDialog
        providers={uiState.providerOptions}
        currentProvider={uiState.selectedProvider}
        onSelect={handleProviderSelect}
        onClose={onClose}
      />
    </Box>
  );
}

export function renderLoadProfileDialog(
  uiState: DialogData,
  uiActions: AppCommands,
  onClose: () => void,
) {
  return (
    <Box flexDirection="column">
      <LoadProfileDialog
        profiles={uiState.profiles}
        onSelect={uiActions.handleProfileSelect}
        onClose={onClose}
      />
    </Box>
  );
}

export function renderCreateProfileDialog(
  uiState: DialogData,
  uiActions: AppCommands,
  onClose: () => void,
) {
  return (
    <Box flexDirection="column">
      <ProfileCreateWizard
        onClose={onClose}
        onLoadProfile={uiActions.handleProfileSelect}
        availableProviders={uiState.createProfileProviders}
      />
    </Box>
  );
}

export function renderProfileListDialogView(
  uiState: DialogData,
  uiActions: AppCommands,
  onClose: () => void,
) {
  return (
    <Box flexDirection="column">
      <ProfileListDialog
        profiles={uiState.profileListItems}
        onSelect={uiActions.loadProfileFromDetail}
        onClose={onClose}
        onViewDetail={uiActions.viewProfileDetail}
        onDelete={uiActions.deleteProfileFromList}
        isLoading={uiState.profileDialogLoading}
        defaultProfileName={uiState.defaultProfileName ?? undefined}
        activeProfileName={uiState.activeProfileName ?? undefined}
      />
    </Box>
  );
}

export function renderProfileDetailDialogView(
  uiState: DialogData,
  uiActions: AppCommands,
) {
  return (
    <Box flexDirection="column">
      <ProfileDetailDialog
        profileName={uiState.selectedProfileName ?? ''}
        profile={uiState.selectedProfileData}
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

export function renderProfileEditorDialogView(
  uiState: DialogData,
  uiActions: AppCommands,
  profile: Profile,
) {
  return (
    <Box flexDirection="column">
      <ProfileInlineEditor
        profileName={uiState.selectedProfileName ?? ''}
        profile={profile}
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

export function renderToolsDialog(
  uiState: DialogData,
  uiActions: AppCommands,
  action: 'enable' | 'disable',
  onClose: () => void,
) {
  return (
    <Box flexDirection="column">
      <ToolsDialog
        tools={uiState.toolsDialogTools}
        action={action}
        disabledTools={uiState.toolsDialogDisabledTools}
        onSelect={uiActions.handleToolsSelect}
        onClose={onClose}
      />
    </Box>
  );
}

export function renderModelsDialog(
  data: ModelsDialogData,
  handleModelsDialogSelect: (model: HydratedModel) => void,
  currentProvider: string | null,
  close: () => void,
) {
  return (
    <Box flexDirection="column">
      <ModelsDialog
        onSelect={handleModelsDialogSelect}
        onClose={close}
        initialSearch={data.initialSearch}
        initialFilters={data.initialFilters}
        includeDeprecated={data.includeDeprecated}
        currentProvider={currentProvider}
        initialProviderFilter={data.providerOverride}
        showAllProviders={data.showAllProviders}
      />
    </Box>
  );
}

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 * @plan PLAN-20260214-SESSIONBROWSER.P23
 */
export function renderSessionBrowserDialog(
  config: CliUiRuntime,
  commandContext: {
    ui: { pendingItem: unknown };
    recordingSwapCallbacks?: ResumeContext['recordingCallbacks'];
  },
  handleSessionBrowserSelect: (
    target: ContinueTarget,
  ) => Promise<PerformResumeResult>,
  close: () => void,
) {
  const chatsDir = join(config.getProjectTempDir(), 'chats');
  const projectHash = getProjectHash(config.getProjectRoot());
  const currentSessionId = config.getSessionId();
  const hasActiveConversation = commandContext.ui.pendingItem !== null;
  return (
    <Box flexDirection="column">
      <SessionBrowserDialog
        chatsDir={chatsDir}
        projectHash={projectHash}
        currentSessionId={currentSessionId}
        hasActiveConversation={hasActiveConversation}
        activeRecording={
          commandContext.recordingSwapCallbacks?.getCurrentRecording() ?? null
        }
        mediaStore={config.getLocalMediaStore()}
        onSelect={handleSessionBrowserSelect}
        onClose={close}
      />
    </Box>
  );
}
