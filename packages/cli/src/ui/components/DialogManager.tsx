/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliUiRuntime } from '../cliUiRuntime.js';
import { Box, Text } from 'ink';
import { useCallback, useMemo } from 'react';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type {
  ContinueTarget,
  HydratedModel,
} from '@vybestack/llxprt-code-core';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { join } from 'node:path';
import {
  performResume,
  type PerformResumeResult,
  type ResumeContext,
} from '../../services/performResume.js';
import {
  iContentToHistoryItems,
  resolveEmojiFilterMode,
} from '../utils/iContentToHistoryItems.js';
// import { LoopDetectionConfirmation } from './LoopDetectionConfirmation.js'; // NOTE: Not yet ported from upstream
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { WelcomeDialog } from './WelcomeOnboarding/WelcomeDialog.js';

import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
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
import { PrivacyNotice } from '../privacy/PrivacyNotice.js';
import { WorkspaceMigrationDialog } from './WorkspaceMigrationDialog.js';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import { LoggingDialog } from './LoggingDialog.js';
import { SubagentManagerDialog } from './SubagentManagement/index.js';
import { SubagentView } from './SubagentManagement/types.js';
import { ModelsDialog } from './ModelDialog.js';
import type { ModelsDialogData } from '../commands/types.js';
import { ModelConfigDialog } from './ModelConfigDialog.js';
import { PoliciesDialog } from './PoliciesDialog.js';
import { useModelDialogHandler } from './modelDialogHandler.js';
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 */
import { SessionBrowserDialog } from './SessionBrowserDialog.js';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { useDialogStore } from '../stores/dialog/DialogContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import {
  selectActiveDialog,
  type DialogKind,
  type DialogRequest,
} from '../stores/dialog/dialogStore.js';
import type { LoadedSettings, SettingScope } from '../../config/settings.js';
import { type UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { firstNonEmptyString } from '../../utils/coalesce.js';
// import { IdeTrustChangeDialog } from './IdeTrustChangeDialog.js'; // NOTE: Not yet ported from upstream

interface DialogManagerProps {
  addItem: UseHistoryManagerReturn['addItem'];
  terminalWidth: number;
  config: CliUiRuntime;
  settings: LoadedSettings;
}

const dialogManagerLogger = new DebugLogger('llxprt:ui:dialogmanager');

/** Entry shape LoggingDialog renders; mirrors the token-usage log records. */
type LoggingDialogEntries = Array<{
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
}>;

/**
 * Handler for SessionBrowserDialog selection - performs real session resume.
 * @plan PLAN-20260214-SESSIONBROWSER.P23
 * @requirement REQ-PR-001, REQ-PR-002
 */
function useSessionBrowserHandler(
  config: CliUiRuntime,
  commandContext: {
    ui: {
      clear: () => void;
      addItem: UseHistoryManagerReturn['addItem'];
      pendingItem: unknown;
    };
    recordingSwapCallbacks?: unknown;
  },
  addItem: UseHistoryManagerReturn['addItem'],
  closeDialog: (kind: DialogKind) => void,
) {
  return useCallback(
    async (target: ContinueTarget): Promise<PerformResumeResult> => {
      const recordingSwapCallbacks = commandContext.recordingSwapCallbacks;
      if (recordingSwapCallbacks == null) {
        dialogManagerLogger.warn(
          'Cannot resume session: recording infrastructure not available.',
        );
        return {
          ok: false,
          error: 'Recording infrastructure not available.',
        };
      }
      const chatsDir = join(config.getProjectTempDir(), 'chats');
      const projectHash = getProjectHash(config.getProjectRoot());
      const currentSessionId = config.getSessionId();
      const currentProvider = config.getProvider() ?? 'unknown';
      const currentModel = config.getModel();
      const workspaceDirs = [...config.getWorkspaceContext().getDirectories()];
      const resumeContext: ResumeContext = {
        chatsDir,
        projectHash,
        currentSessionId,
        currentProvider,
        currentModel,
        workspaceDirs,
        recordingCallbacks: recordingSwapCallbacks as NonNullable<
          ResumeContext['recordingCallbacks']
        >,
        historyService: config.getAgentClient().getHistoryService(),
        adoptSessionId: (sessionId) => config.adoptSessionId(sessionId),
        logger: dialogManagerLogger,
      };
      const ref =
        target.kind === 'session'
          ? target.session.sessionId
          : target.checkpointId;
      const resumeResult = await performResume(ref, resumeContext);
      if (!resumeResult.ok) {
        addItem({ type: 'error', text: resumeResult.error });
        return resumeResult;
      }
      for (const warning of resumeResult.warnings) {
        addItem({ type: 'info', text: `Warning: ${warning}` });
      }
      const uiHistory = iContentToHistoryItems(
        resumeResult.history,
        resolveEmojiFilterMode(config),
      );
      commandContext.ui.clear();
      uiHistory.forEach((item, index) => {
        commandContext.ui.addItem(item, index);
      });
      closeDialog('sessionBrowser');
      return resumeResult;
    },
    [config, commandContext, addItem, closeDialog],
  );
}

/**
 * Early dialogs, rendered from the active DialogStore entry. These kinds
 * outrank every body dialog in DIALOG_PRIORITY, so the switch mirrors the
 * former renderEarlyDialogs if-chain exactly.
 */
function renderEarlyStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  terminalWidth: number,
  close: (kind: DialogKind) => void,
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

function renderThemeDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
  constrainHeight: boolean,
  terminalHeight: number,
  staticExtraHeight: number,
  mainAreaWidth: number,
) {
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

function renderAuthDialog(
  uiState: ReturnType<typeof useUIState>,
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

function renderOAuthCodeDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderEditorDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
  onExit: () => void,
) {
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
        onExit={onExit}
      />
    </Box>
  );
}

function renderProviderDialog(
  uiState: ReturnType<typeof useUIState>,
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

function renderLoadProfileDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderCreateProfileDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderProfileListDialogView(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderProfileDetailDialogView(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderProfileEditorDialogView(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderToolsDialog(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
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

function renderModelsDialog(
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
function renderSessionBrowserDialog(
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

function useDialogManagerState(
  addItem: UseHistoryManagerReturn['addItem'],
  config: CliUiRuntime,
  settings: LoadedSettings,
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  runtime: ReturnType<typeof useRuntimeApi>,
  _terminalWidth: number,
) {
  const { constrainHeight, terminalHeight, mainAreaWidth, commandContext } =
    uiState;
  const staticExtraHeight = 0;

  // Store-backed dialogs are read here — the only hook-legal site — and
  // threaded through the state bag so the pure render helpers stay pure.
  const dialogStore = useDialogStore();
  const activeStoreDialog = useStoreSelector(
    dialogStore.store,
    selectActiveDialog,
  );

  const currentProvider = useMemo(() => {
    try {
      return runtime.getActiveProviderName() || null;
    } catch {
      return null;
    }
  }, [runtime]);

  const handleAuthSelect = useCallback(
    (method: string | undefined, scope: SettingScope) => {
      void uiActions.handleAuthSelect(method, scope);
    },
    [uiActions],
  );

  const handleOAuthCodeSubmit = useCallback(
    (code: string) => {
      void uiActions.handleOAuthCodeSubmit(code);
    },
    [uiActions],
  );

  const handleProviderSelect = useCallback(
    (provider: string) => {
      void uiActions.handleProviderSelect(provider);
    },
    [uiActions],
  );

  const handleModelsDialogSelect = useModelDialogHandler(
    runtime,
    addItem,
    dialogStore,
    currentProvider,
    commandContext,
  );

  const handleSessionBrowserSelect = useSessionBrowserHandler(
    config,
    commandContext,
    addItem,
    dialogStore.commands.closeDialog,
  );

  return {
    terminalWidth: _terminalWidth,
    constrainHeight,
    terminalHeight,
    mainAreaWidth,
    commandContext,
    staticExtraHeight,
    currentProvider,
    handleAuthSelect,
    handleOAuthCodeSubmit,
    handleProviderSelect,
    handleModelsDialogSelect,
    handleSessionBrowserSelect,
    activeStoreDialog,
    closeStoreDialog: dialogStore.commands.closeDialog,
  };
}

interface StoreDialogRenderContext {
  uiState: ReturnType<typeof useUIState>;
  uiActions: ReturnType<typeof useUIActions>;
  settings: LoadedSettings;
  config: CliUiRuntime;
  addItem: UseHistoryManagerReturn['addItem'];
}

function renderProfileStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  close: (kind: DialogKind) => void,
) {
  const { uiState, uiActions } = ctx;
  switch (active.kind) {
    case 'loadProfile':
      return renderLoadProfileDialog(uiState, uiActions, () =>
        close('loadProfile'),
      );
    case 'createProfile':
      return renderCreateProfileDialog(uiState, uiActions, () =>
        close('createProfile'),
      );
    case 'profileList':
      return renderProfileListDialogView(uiState, uiActions, () =>
        close('profileList'),
      );
    case 'profileDetail':
      return renderProfileDetailDialogView(uiState, uiActions);
    case 'profileEditor':
      if (uiState.selectedProfileData != null) {
        return renderProfileEditorDialogView(
          uiState,
          uiActions,
          uiState.selectedProfileData,
        );
      }
      return null;
    default:
      return undefined;
  }
}

function renderPayloadStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  close: (kind: DialogKind) => void,
) {
  const { uiState, uiActions, config, addItem } = ctx;
  switch (active.kind) {
    case 'tools':
      return renderToolsDialog(uiState, uiActions, active.payload.action, () =>
        close('tools'),
      );
    case 'permissions':
      return (
        <PermissionsModifyTrustDialog
          onExit={() => close('permissions')}
          addItem={addItem}
          config={config}
        />
      );
    case 'logging':
      return (
        <LoggingDialog
          entries={active.payload.entries as LoggingDialogEntries}
          onClose={() => close('logging')}
        />
      );
    case 'subagent':
      return (
        <SubagentManagerDialog
          onClose={() => close('subagent')}
          initialView={active.payload.initialView ?? SubagentView.MENU}
          initialSubagentName={active.payload.initialName}
        />
      );
    default:
      return undefined;
  }
}

/** Settings-family store dialogs: theme picker, settings menu, editor picker. */
function renderSettingsStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  state: ReturnType<typeof useDialogManagerState>,
  close: (kind: DialogKind) => void,
) {
  const { uiState, uiActions, settings, config } = ctx;
  switch (active.kind) {
    case 'theme':
      return renderThemeDialog(
        uiState,
        uiActions,
        settings,
        state.constrainHeight,
        state.terminalHeight,
        state.staticExtraHeight,
        state.mainAreaWidth,
      );
    case 'settings':
      return (
        <Box flexDirection="column">
          <SettingsDialog
            settings={settings}
            onSelect={() => close('settings')}
            onRestartRequest={uiActions.handleSettingsRestart}
            config={config}
          />
        </Box>
      );
    case 'editor':
      return renderEditorDialog(uiState, uiActions, settings, () =>
        close('editor'),
      );
    default:
      return undefined;
  }
}

/** Account store dialogs: auth method, OAuth code entry, provider picker. */
function renderAccountStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  state: ReturnType<typeof useDialogManagerState>,
  close: (kind: DialogKind) => void,
) {
  const { uiState, uiActions, settings } = ctx;
  switch (active.kind) {
    case 'auth':
      return renderAuthDialog(uiState, settings, state.handleAuthSelect);
    case 'oauthCode':
      return renderOAuthCodeDialog(
        uiState,
        uiActions,
        state.handleOAuthCodeSubmit,
      );
    case 'provider':
      return renderProviderDialog(uiState, state.handleProviderSelect, () =>
        close('provider'),
      );
    default:
      return undefined;
  }
}

/**
 * Remaining store dialogs whose data lives inside the dialog component
 * itself: privacy notice, model picker, session browser, model config, and
 * policies.
 */
function renderUtilityStoreDialog(
  active: DialogRequest,
  ctx: StoreDialogRenderContext,
  state: ReturnType<typeof useDialogManagerState>,
) {
  const { config, addItem } = ctx;
  const close = state.closeStoreDialog;
  switch (active.kind) {
    case 'privacy':
      return <PrivacyNotice onExit={() => close('privacy')} config={config} />;
    case 'models':
      return renderModelsDialog(
        active.payload,
        state.handleModelsDialogSelect,
        state.currentProvider,
        () => close('models'),
      );
    case 'sessionBrowser':
      return renderSessionBrowserDialog(
        config,
        state.commandContext,
        state.handleSessionBrowserSelect,
        () => close('sessionBrowser'),
      );
    case 'modelConfig':
      return (
        <Box flexDirection="column">
          <ModelConfigDialog onClose={() => close('modelConfig')} />
        </Box>
      );
    case 'policies':
      return (
        <PoliciesDialog
          config={config}
          addItem={addItem}
          onExit={() => close('policies')}
        />
      );
    default:
      return undefined;
  }
}

/**
 * Store-backed dialogs: rendered from the active DialogStore entry instead of
 * per-dialog booleans. Dialog data (provider lists, profiles, tools) still
 * flows through UIState until the data-store slices land. The kind groups are
 * disjoint, so the router tries each focused helper until one claims the
 * kind. Only renderProfileStoreDialog can return null (profileEditor with no
 * loaded data renders nothing), which the explicit check preserves.
 */
function renderStoreBackedDialog(
  active: DialogRequest | null,
  ctx: StoreDialogRenderContext,
  state: ReturnType<typeof useDialogManagerState>,
) {
  if (active == null) {
    return undefined;
  }
  const close = state.closeStoreDialog;
  const profile = renderProfileStoreDialog(active, ctx, close);
  if (profile !== undefined) {
    return profile;
  }
  const payload = renderPayloadStoreDialog(active, ctx, close);
  if (payload !== undefined) {
    return payload;
  }
  return (
    renderEarlyStoreDialog(active, ctx, state.terminalWidth, close) ??
    renderSettingsStoreDialog(active, ctx, state, close) ??
    renderAccountStoreDialog(active, ctx, state, close) ??
    renderUtilityStoreDialog(active, ctx, state)
  );
}

function renderDialogBody(
  uiState: ReturnType<typeof useUIState>,
  uiActions: ReturnType<typeof useUIActions>,
  settings: LoadedSettings,
  config: CliUiRuntime,
  addItem: UseHistoryManagerReturn['addItem'],
  state: ReturnType<typeof useDialogManagerState>,
) {
  return renderStoreBackedDialog(
    state.activeStoreDialog,
    { uiState, uiActions, settings, config, addItem },
    state,
  );
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

  const state = useDialogManagerState(
    addItem,
    config,
    settings,
    uiState,
    uiActions,
    runtime,
    terminalWidth,
  );

  // NOTE: IdeTrustChangeDialog not yet ported from upstream
  return renderDialogBody(uiState, uiActions, settings, config, addItem, state);
};
