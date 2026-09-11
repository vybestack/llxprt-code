/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliUiRuntime } from '../cliUiRuntime.js';
import { Box } from 'ink';
import { useCallback, useMemo } from 'react';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { ContinueTarget } from '@vybestack/llxprt-code-core';
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
import { SettingsDialog } from './SettingsDialog.js';
import { PrivacyNotice } from '../privacy/PrivacyNotice.js';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import { LoggingDialog } from './LoggingDialog.js';
import { SubagentManagerDialog } from './SubagentManagement/index.js';
import { SubagentView } from './SubagentManagement/types.js';
import { ModelConfigDialog } from './ModelConfigDialog.js';
import { PoliciesDialog } from './PoliciesDialog.js';
import { useModelDialogHandler } from './modelDialogHandler.js';
import {
  type DialogData,
  type StoreDialogRenderContext,
  renderAuthDialog,
  renderCreateProfileDialog,
  renderEarlyStoreDialog,
  renderEditorDialog,
  renderLoadProfileDialog,
  renderModelsDialog,
  renderOAuthCodeDialog,
  renderProfileDetailDialogView,
  renderProfileEditorDialogView,
  renderProfileListDialogView,
  renderProviderDialog,
  renderSessionBrowserDialog,
  renderThemeDialog,
  renderToolsDialog,
} from './DialogManagerRenderers.js';
import {
  useAppCommands,
  type AppCommands,
} from '../contexts/AppCommandsContext.js';
import { useSettingsProfileStore } from '../stores/settings/SettingsContext.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useDialogStore } from '../stores/dialog/DialogContext.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import {
  selectActiveDialog,
  type DialogKind,
  type DialogRequest,
} from '../stores/dialog/dialogStore.js';
import type { LoadedSettings, SettingScope } from '../../config/settings.js';
import { type UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
// import { IdeTrustChangeDialog } from './IdeTrustChangeDialog.js'; // NOTE: Not yet ported from upstream

interface DialogManagerProps {
  config: CliUiRuntime;
  settings: LoadedSettings;
}

const dialogManagerLogger = new DebugLogger('llxprt:ui:dialogmanager');

function useDialogData(): DialogData {
  const { store } = useSettingsProfileStore();
  const welcomeState = useStoreSelector(store, (s) => s.welcomeState);
  const welcomeAvailableProviders = useStoreSelector(
    store,
    (s) => s.welcomeAvailableProviders,
  );
  const welcomeAvailableModels = useStoreSelector(
    store,
    (s) => s.welcomeAvailableModels,
  );
  const authError = useStoreSelector(store, (s) => s.authError);
  const providerOptions = useStoreSelector(store, (s) => s.providerOptions);
  const selectedProvider = useStoreSelector(store, (s) => s.selectedProvider);
  const profiles = useStoreSelector(store, (s) => s.profiles);
  const createProfileProviders = useStoreSelector(
    store,
    (s) => s.createProfileProviders,
  );
  const profileListItems = useStoreSelector(store, (s) => s.profileListItems);
  const profileDialogLoading = useStoreSelector(
    store,
    (s) => s.profileDialogLoading,
  );
  const profileDialogError = useStoreSelector(
    store,
    (s) => s.profileDialogError,
  );
  const selectedProfileName = useStoreSelector(
    store,
    (s) => s.selectedProfileName,
  );
  const selectedProfileData = useStoreSelector(
    store,
    (s) => s.selectedProfileData,
  );
  const defaultProfileName = useStoreSelector(
    store,
    (s) => s.defaultProfileName,
  );
  const activeProfileName = useStoreSelector(store, (s) => s.activeProfileName);
  const toolsDialogTools = useStoreSelector(store, (s) => s.toolsDialogTools);
  const toolsDialogDisabledTools = useStoreSelector(
    store,
    (s) => s.toolsDialogDisabledTools,
  );
  return {
    welcomeState,
    welcomeAvailableProviders,
    welcomeAvailableModels,
    authError,
    providerOptions,
    selectedProvider,
    profiles,
    createProfileProviders,
    profileListItems,
    profileDialogLoading,
    profileDialogError,
    selectedProfileName,
    selectedProfileData,
    defaultProfileName,
    activeProfileName,
    toolsDialogTools,
    toolsDialogDisabledTools,
  };
}

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

/** Terminal-plane values via narrow primitive selectors (hook-legal site). */
function useTerminalDialogValues() {
  const { store } = useTerminalStore();
  const terminalWidth = useStoreSelector(store, (s) => s.terminalWidth);
  const terminalHeight = useStoreSelector(store, (s) => s.terminalHeight);
  const mainAreaWidth = useStoreSelector(store, (s) => s.mainAreaWidth);
  const constrainHeight = useStoreSelector(store, (s) => s.constrainHeight);
  return { terminalWidth, terminalHeight, mainAreaWidth, constrainHeight };
}

function useDialogManagerState(
  addItem: UseHistoryManagerReturn['addItem'],
  config: CliUiRuntime,
  settings: LoadedSettings,
  uiActions: AppCommands,
  runtime: ReturnType<typeof useRuntimeApi>,
) {
  const { commandContext } = useAppCommands();
  const staticExtraHeight = 0;

  // Store-backed dialogs are read here — the only hook-legal site — and
  // threaded through the state bag so the pure render helpers stay pure.
  const dialogStore = useDialogStore();
  const activeStoreDialog = useStoreSelector(
    dialogStore.store,
    selectActiveDialog,
  );
  const { terminalWidth, terminalHeight, mainAreaWidth, constrainHeight } =
    useTerminalDialogValues();

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
    terminalWidth,
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
  const { uiActions, settings, config } = ctx;
  switch (active.kind) {
    case 'theme':
      return renderThemeDialog(
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
      return renderEditorDialog(uiActions, settings, () => close('editor'));
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
  uiState: DialogData,
  uiActions: AppCommands,
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
export const DialogManager = ({ config, settings }: DialogManagerProps) => {
  const uiState = useDialogData();
  const uiActions = useAppCommands();
  const runtime = useRuntimeApi();
  const { addItem } = useTurnStore().commands;

  const state = useDialogManagerState(
    addItem,
    config,
    settings,
    uiActions,
    runtime,
  );

  // NOTE: IdeTrustChangeDialog not yet ported from upstream
  return renderDialogBody(uiState, uiActions, settings, config, addItem, state);
};
