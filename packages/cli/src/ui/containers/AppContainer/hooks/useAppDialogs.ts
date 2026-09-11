/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandRuntime } from '../../../cliUiRuntime.js';
import type React from 'react';
import type { AppAction } from '../../../reducers/appReducer.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useThemeCommand } from '../../../hooks/useThemeCommand.js';
import { useAuthCommand } from '../../../hooks/useAuthCommand.js';
import { useFolderTrust } from '../../../hooks/useFolderTrust.js';
import { useWelcomeOnboarding } from '../../../hooks/useWelcomeOnboarding.js';
import { useEditorSettings } from '../../../hooks/useEditorSettings.js';
import { useExtensionUpdates } from '../../../hooks/useExtensionUpdates.js';
import { useOAuthOrchestration } from '../../../hooks/useOAuthOrchestration.js';
import { useProviderDialog } from '../../../hooks/useProviderDialog.js';
import { useLoadProfileDialog } from '../../../hooks/useLoadProfileDialog.js';
import { useCreateProfileDialog } from '../../../hooks/useCreateProfileDialog.js';
import { useProfileManagement } from '../../../hooks/useProfileManagement.js';
import { useToolsDialog } from '../../../hooks/useToolsDialog.js';
import { useWorkspaceMigration } from '../../../hooks/useWorkspaceMigration.js';
import { useDisplayPreferences } from './useDisplayPreferences.js';
import { useModelTracking } from './useModelTracking.js';
import { useIdeContextBridge } from './useIdeContextBridge.js';
import { useQueueErrorTimeout } from './useQueueErrorTimeout.js';
import { useMemoryRefreshAction } from './useMemoryRefreshAction.js';
import { useModelRuntimeSync } from './useModelRuntimeSync.js';
import { useAppEventHandlers } from './useAppEventHandlers.js';
import { resolveModelIdentity } from '../../../utils/modelIdentity.js';
import type { useRuntimeApi } from '../../../contexts/RuntimeContext.js';
import type {
  IdeContext,
  IdeInfo,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { ConsoleMessageItem } from '../../../types.js';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type { TurnStore } from '../../../stores/turn/turnStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';

const QUEUE_ERROR_DISPLAY_DURATION_MS = 3000;

export interface AppDialogsParams {
  config: SlashCommandRuntime;
  agent: Agent;
  settings: LoadedSettings;
  store: DialogStore;
  dialogs: DialogOpeners;
  /** Terminal store; dialogs owns the capability-sync writer effect. */
  terminalStore: TerminalStore;
  /**
   * Turn store; owns staticKey/isProcessing state and the history addItem
   * command the dialog data loaders message through.
   */
  turnStore: TurnStore;
  /** Dispatch for the reducer-held actions OAuth completion still needs. */
  appDispatch: React.Dispatch<AppAction>;
  handleNewMessage: (message: ConsoleMessageItem) => void;
  recordingIntegration?: RecordingIntegration;
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>;
  runtime: ReturnType<typeof useRuntimeApi>;
  consoleMessages: ConsoleMessageItem[];
  setLlxprtMdFileCount: (count: number) => void;
  suppressStartupWelcome?: boolean;
  /** IDE nudge visibility + identity from bootstrap; open state lives in DialogStore. */
  shouldShowIdePrompt: boolean | null | undefined;
  currentIDE: IdeInfo | undefined;
}

function useDialogsState(turnStore: TurnStore) {
  const { refreshStatic, setIsProcessing } = turnStore.commands;
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [themeError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [editorError] = useState<string | null>(null);
  const [shellModeActive, setShellModeActive] = useState(false);
  const [ideContextState, setIdeContextState] = useState<
    IdeContext | undefined
  >();
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const [embeddedShellFocused, setEmbeddedShellFocused] = useState(false);
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(
    null,
  );
  // toggleCorgiMode is retained as a no-op interface required by slash commands;
  // the _corgiMode state it previously toggled was never read or rendered.
  const toggleCorgiMode = useCallback(() => {}, []);
  const handleExternalEditorOpen = useCallback(() => {}, []);
  const handleEscapePromptChange = useCallback((show: boolean) => {
    setShowEscapePrompt(show);
  }, []);
  return {
    refreshStatic,
    handleExternalEditorOpen,
    debugMessage,
    setDebugMessage,
    themeError,
    authError,
    setAuthError,
    editorError,
    shellModeActive,
    setShellModeActive,
    ideContextState,
    setIdeContextState,
    showEscapePrompt,
    setShowEscapePrompt,
    setIsProcessing,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    queueErrorMessage,
    setQueueErrorMessage,
    toggleCorgiMode,
    handleEscapePromptChange,
  };
}

function useDialogsCore(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsState>,
) {
  const { config, settings, store, dialogs, consoleMessages } = p;
  const { addItem } = p.turnStore.commands;
  const {
    currentModel,
    setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel,
  } = useModelTracking({ config });
  const [contextLimit, setContextLimit] = useState<number | undefined>(
    () => config.getEphemeralSetting('context-limit') as number | undefined,
  );
  const displayPrefs = useDisplayPreferences();
  const workspace = useWorkspaceMigration(settings, dialogs);
  const extensions = config.getExtensions();
  const extUpdates = useExtensionUpdates(
    extensions,
    addItem,
    config.getWorkingDir(),
    store,
  );
  useIdeContextBridge({ setIdeContextState: st.setIdeContextState });
  const errorCount = useMemo(
    () =>
      consoleMessages
        .filter((m) => m.type === 'error')
        .reduce((t, m) => t + m.count, 0),
    [consoleMessages],
  );
  return {
    currentModel,
    setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel,
    contextLimit,
    setContextLimit,
    ...displayPrefs,
    ...workspace,
    ...extUpdates,
    errorCount,
  };
}

function useIdeTrustEffect(
  config: AppDialogsParams['config'],
  st: ReturnType<typeof useDialogsState>,
) {
  useQueueErrorTimeout({
    queueErrorMessage: st.queueErrorMessage,
    setQueueErrorMessage: st.setQueueErrorMessage,
    timeoutMs: QUEUE_ERROR_DISPLAY_DURATION_MS,
  });
}

function useDialogsAuthProviders(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsState>,
  currentModel: string,
  setCurrentModel: (model: string) => void,
  currentModelLabel: string | undefined,
  setCurrentModelLabel: (label: string) => void,
  contextLimit: number | undefined,
  setContextLimit: (limit: number | undefined) => void,
) {
  const {
    config,
    settings,
    handleNewMessage,
    recordingIntegration,
    runtime,
    store,
    dialogs,
  } = p;
  const { addItem } = p.turnStore.commands;
  const auth = useAuthCommand(settings, dialogs, st.setAuthError);
  const isOAuthCodeDialogOpen = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'oauthCode'),
  );
  useOAuthOrchestration({
    appDispatch: p.appDispatch,
    dialogs,
    isOAuthCodeDialogOpen,
    getActiveProviderName: runtime.getActiveProviderName,
    setAuthError: st.setAuthError,
  });
  const editor = useEditorSettings(settings, dialogs, addItem);
  const provider = useProviderDialog({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    store,
    dialogs,
    recordingIntegration,
  });
  useModelRuntimeSync({
    config,
    currentModel,
    setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel,
    getActiveModelName: runtime.getActiveModelName,
    getActiveProviderName: runtime.getActiveProviderName,
    resolveModelDisplayLabel: () => resolveModelIdentity(runtime),
    contextLimit,
    setContextLimit,
  });
  useAppEventHandlers({
    handleNewMessage,
    setShowErrorDetails: p.terminalStore.commands.setShowErrorDetails,
    setConstrainHeight: p.terminalStore.commands.setConstrainHeight,
  });
  return {
    handleAuthSelect: auth.handleAuthSelect,
    openProviderDialog: provider.openDialog,
    handleEditorSelect: editor.handleEditorSelect,
    handleProviderSelect: provider.handleSelect,
    providerOptions: provider.providers,
    selectedProvider: provider.currentProvider,
  };
}

function useDialogsAuth(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsState>,
  currentModel: string,
  setCurrentModel: (model: string) => void,
  currentModelLabel: string | undefined,
  setCurrentModelLabel: (label: string) => void,
  contextLimit: number | undefined,
  setContextLimit: (limit: number | undefined) => void,
) {
  const { config, settings, store, dialogs } = p;
  const { addItem } = p.turnStore.commands;
  const theme = useThemeCommand(settings, dialogs, addItem);
  const folderTrust = useFolderTrust({
    settings,
    addItem,
    config,
    store,
    dialogs,
  });
  const welcome = useWelcomeOnboarding({
    settings,
    isFolderTrustComplete: !folderTrust.isFolderTrustDialogOpen,
    agent: p.agent,
    suppressStartup: p.suppressStartupWelcome === true,
  });
  // The welcome dialog mirrors welcome.showWelcome in the DialogStore;
  // dismiss/resetAndReopen flip showWelcome and this effect follows.
  useEffect(() => {
    if (welcome.showWelcome) {
      dialogs.welcome.open({});
    } else {
      dialogs.welcome.close();
    }
  }, [welcome.showWelcome, dialogs]);
  useEffect(() => {
    if (p.shouldShowIdePrompt === true && p.currentIDE) {
      dialogs.idePrompt.open({ ide: p.currentIDE });
    } else {
      dialogs.idePrompt.close();
    }
  }, [p.shouldShowIdePrompt, p.currentIDE, dialogs]);
  useIdeTrustEffect(config, st);
  const authProviders = useDialogsAuthProviders(
    p,
    st,
    currentModel,
    setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel,
    contextLimit,
    setContextLimit,
  );
  return {
    handleThemeSelect: theme.handleThemeSelect,
    handleThemeHighlight: theme.handleThemeHighlight,
    handleFolderTrustSelect: folderTrust.handleFolderTrustSelect,
    welcomeState: welcome.state,
    welcomeActions: welcome.actions,
    welcomeAvailableProviders: welcome.availableProviders,
    welcomeAvailableModels: welcome.availableModels,
    triggerWelcomeAuth: welcome.triggerAuth,
    ...authProviders,
  };
}

function useDialogsProfiles(p: AppDialogsParams) {
  const { config, agent, settings, setLlxprtMdFileCount, store, dialogs } = p;
  const { addItem } = p.turnStore.commands;
  const loadProfile = useLoadProfileDialog({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    store,
    dialogs,
  });
  const createProfile = useCreateProfileDialog({ store, dialogs });
  const profileMgmt = useProfileManagement({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    store,
    dialogs,
  });
  const toolsRaw = useToolsDialog({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    store,
    dialogs,
    config,
    agent,
  });
  const performMemoryRefresh = useMemoryRefreshAction({
    config,
    settings,
    addItem,
    setLlxprtMdFileCount,
  });
  return {
    openLoadProfileDialog: loadProfile.openDialog,
    handleProfileSelect: loadProfile.handleSelect,
    profiles: loadProfile.profiles,
    openCreateProfileDialog: createProfile.openDialog,
    createProfileProviders: createProfile.providers,
    openProfileListDialog: profileMgmt.openListDialog,
    closeProfileDetailDialog: profileMgmt.closeDetailDialog,
    profileListItems: profileMgmt.profiles,
    profileDialogLoading: profileMgmt.isLoading,
    selectedProfileName: profileMgmt.selectedProfileName,
    selectedProfileData: profileMgmt.selectedProfile,
    defaultProfileName: profileMgmt.defaultProfileName,
    activeProfileName: profileMgmt.activeProfileName,
    profileDialogError: profileMgmt.profileError,
    viewProfileDetail: profileMgmt.viewProfileDetail,
    loadProfileFromDetail: profileMgmt.loadProfile,
    deleteProfileFromDetail: profileMgmt.deleteProfile,
    deleteProfileFromList: profileMgmt.deleteProfileFromList,
    setProfileAsDefault: profileMgmt.setDefault,
    openProfileEditor: profileMgmt.openEditor,
    closeProfileEditor: profileMgmt.closeEditor,
    saveProfileFromEditor: profileMgmt.saveProfile,
    toolsDialogAction: toolsRaw.action,
    toolsDialogTools: toolsRaw.availableTools,
    toolsDialogDisabledTools: toolsRaw.disabledTools,
    handleToolsSelect: toolsRaw.handleSelect,
    performMemoryRefresh,
  };
}

/**
 * Terminal capability flags follow settings and the host terminal. The
 * settingsNonce dep re-syncs when CoreEvent.SettingsChanged fires (settings
 * can keep identity while merged values flip).
 */
function useTerminalCapabilitySync(
  p: AppDialogsParams,
  settingsNonce: number,
): void {
  const { config, settings, terminalStore } = p;
  useEffect(() => {
    terminalStore.commands.setCapabilities({
      useAlternateBuffer:
        settings.merged.ui.useAlternateBuffer === true &&
        !config.getScreenReader(),
      screenReaderEnabled: config.getScreenReader(),
    });
  }, [config, settings, terminalStore, settingsNonce]);
}

export function useAppDialogs(params: AppDialogsParams) {
  const st = useDialogsState(params.turnStore);
  const core = useDialogsCore(params, st);
  useTerminalCapabilitySync(params, core.settingsNonce);
  const auth = useDialogsAuth(
    params,
    st,
    core.currentModel,
    core.setCurrentModel,
    core.currentModelLabel,
    core.setCurrentModelLabel,
    core.contextLimit,
    core.setContextLimit,
  );
  const profiles = useDialogsProfiles(params);
  const [startupGuardsInitialized, setStartupGuardsInitialized] =
    useState(false);
  useEffect(() => {
    setStartupGuardsInitialized(true);
  }, []);
  return { ...st, ...core, ...auth, ...profiles, startupGuardsInitialized };
}

export type AppDialogsResult = ReturnType<typeof useAppDialogs>;
