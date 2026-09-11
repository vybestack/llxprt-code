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
import type { UseWelcomeOnboardingReturn } from '../../../hooks/useWelcomeOnboarding.js';
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
  IdeInfo,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { ConsoleMessageItem } from '../../../types.js';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type {
  ProfileListItem,
  SettingsProfileStore,
} from '../../../stores/settings/settingsStore.js';
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
   * Settings/profile store; dialogs owns the data-projection writer effects
   * (model identity, provider/profile/tools dialog data, welcome data).
   */
  settingsStore: SettingsProfileStore;
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

/**
 * Composer/input-plane flags read through narrow store selectors; the setters
 * are the TerminalStore/SettingsProfileStore commands. The former useState
 * families (debug/auth errors, shell mode, escape prompt, queue error,
 * embedded shell focus) moved here in slice D.
 */
function useDialogsStoreState(
  terminalStore: TerminalStore,
  settingsStore: SettingsProfileStore,
) {
  const debugMessage = useStoreSelector(
    settingsStore.store,
    (s) => s.debugMessage,
  );
  const authError = useStoreSelector(settingsStore.store, (s) => s.authError);
  const shellModeActive = useStoreSelector(
    terminalStore.store,
    (s) => s.shellModeActive,
  );
  const ideContextState = useStoreSelector(
    settingsStore.store,
    (s) => s.ideContextState,
  );
  const showEscapePrompt = useStoreSelector(
    terminalStore.store,
    (s) => s.showEscapePrompt,
  );
  const embeddedShellFocused = useStoreSelector(
    terminalStore.store,
    (s) => s.embeddedShellFocused,
  );
  const queueErrorMessage = useStoreSelector(
    terminalStore.store,
    (s) => s.queueErrorMessage,
  );
  // toggleCorgiMode is retained as a no-op interface required by slash commands;
  // the _corgiMode state it previously toggled was never read or rendered.
  const toggleCorgiMode = useCallback(() => {}, []);
  const handleExternalEditorOpen = useCallback(() => {}, []);
  return {
    debugMessage,
    authError,
    shellModeActive,
    ideContextState,
    showEscapePrompt,
    embeddedShellFocused,
    queueErrorMessage,
    setDebugMessage: settingsStore.commands.setDebugMessage,
    setAuthError: settingsStore.commands.setAuthError,
    setShellModeActive: terminalStore.commands.setShellModeActive,
    setIdeContextState: settingsStore.commands.setIdeContextState,
    handleEscapePromptChange: terminalStore.commands.setShowEscapePrompt,
    setEmbeddedShellFocused: terminalStore.commands.setEmbeddedShellFocused,
    setQueueErrorMessage: terminalStore.commands.setQueueErrorMessage,
    toggleCorgiMode,
    handleExternalEditorOpen,
  };
}

function useDialogsCore(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsStoreState>,
) {
  const { config, settings, store, dialogs, consoleMessages, settingsStore } =
    p;
  const { addItem } = p.turnStore.commands;
  const { currentModel, currentModelLabel } = useModelTracking({
    config,
    settingsStore,
  });
  const contextLimit = useStoreSelector(
    settingsStore.store,
    (s) => s.contextLimit,
  );
  useEffect(() => {
    settingsStore.commands.setContextLimit(
      config.getEphemeralSetting('context-limit') as number | undefined,
    );
  }, [config, settingsStore]);
  const displayPrefs = useDisplayPreferences(p.terminalStore, settingsStore);
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
    setCurrentModel: settingsStore.commands.setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel: settingsStore.commands.setCurrentModelLabel,
    contextLimit,
    setContextLimit: settingsStore.commands.setContextLimit,
    ...displayPrefs,
    ...workspace,
    ...extUpdates,
    errorCount,
  };
}

function useIdeTrustEffect(
  config: AppDialogsParams['config'],
  st: ReturnType<typeof useDialogsStoreState>,
) {
  useQueueErrorTimeout({
    queueErrorMessage: st.queueErrorMessage,
    setQueueErrorMessage: st.setQueueErrorMessage,
    timeoutMs: QUEUE_ERROR_DISPLAY_DURATION_MS,
  });
}

function useDialogsAuthProviders(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsStoreState>,
  currentModel: string,
  setCurrentModel: (model: string) => void,
  currentModelLabel: string | undefined,
  setCurrentModelLabel: (label: string | undefined) => void,
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
    providerData: {
      providers: provider.providers,
      currentProvider: provider.currentProvider,
    },
  };
}

function useDialogsAuth(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsStoreState>,
  currentModel: string,
  setCurrentModel: (model: string) => void,
  currentModelLabel: string | undefined,
  setCurrentModelLabel: (label: string | undefined) => void,
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
    welcome,
    triggerWelcomeAuth: welcome.triggerAuth,
    ...authProviders,
  };
}

interface ProfileDialogsData {
  profiles: string[];
  createProfileProviders: string[];
  profileListItems: ProfileListItem[];
  profileDialogLoading: boolean;
  selectedProfileName: string | null;
  selectedProfileData: ReturnType<
    typeof useProfileManagement
  >['selectedProfile'];
  defaultProfileName: string | null;
  activeProfileName: string | null;
  profileDialogError: string | null;
  toolsDialogAction: 'enable' | 'disable';
  toolsDialogTools: ReturnType<typeof useToolsDialog>['availableTools'];
  toolsDialogDisabledTools: string[];
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
  const data: ProfileDialogsData = {
    profiles: loadProfile.profiles,
    createProfileProviders: createProfile.providers,
    profileListItems: profileMgmt.profiles,
    profileDialogLoading: profileMgmt.isLoading,
    selectedProfileName: profileMgmt.selectedProfileName,
    selectedProfileData: profileMgmt.selectedProfile,
    defaultProfileName: profileMgmt.defaultProfileName,
    activeProfileName: profileMgmt.activeProfileName,
    profileDialogError: profileMgmt.profileError,
    toolsDialogAction: toolsRaw.action,
    toolsDialogTools: toolsRaw.availableTools,
    toolsDialogDisabledTools: toolsRaw.disabledTools,
  };
  return {
    openLoadProfileDialog: loadProfile.openDialog,
    handleProfileSelect: loadProfile.handleSelect,
    openCreateProfileDialog: createProfile.openDialog,
    openProfileListDialog: profileMgmt.openListDialog,
    closeProfileDetailDialog: profileMgmt.closeDetailDialog,
    viewProfileDetail: profileMgmt.viewProfileDetail,
    loadProfileFromDetail: profileMgmt.loadProfile,
    deleteProfileFromDetail: profileMgmt.deleteProfile,
    deleteProfileFromList: profileMgmt.deleteProfileFromList,
    setProfileAsDefault: profileMgmt.setDefault,
    openProfileEditor: profileMgmt.openEditor,
    closeProfileEditor: profileMgmt.closeEditor,
    saveProfileFromEditor: profileMgmt.saveProfile,
    handleToolsSelect: toolsRaw.handleSelect,
    performMemoryRefresh,
    data,
  };
}

/**
 * Mirror effects projecting dialog data into the settings/profile store.
 * The feature hooks stay value-returning; this is the single writer site so
 * the projection order matches the hook evaluation order.
 */
function useDialogDataSync(
  settingsStore: SettingsProfileStore,
  welcome: UseWelcomeOnboardingReturn,
  providerData: { providers: string[]; currentProvider: string },
  profileData: ProfileDialogsData,
  errorCount: number,
): void {
  const commands = settingsStore.commands;
  useEffect(() => {
    commands.setWelcomeState(welcome.state);
  }, [commands, welcome.state]);
  useEffect(() => {
    commands.setWelcomeAvailableProviders(welcome.availableProviders);
  }, [commands, welcome.availableProviders]);
  useEffect(() => {
    commands.setWelcomeAvailableModels(welcome.availableModels);
  }, [commands, welcome.availableModels]);
  useEffect(() => {
    commands.setProviderOptions(providerData.providers);
  }, [commands, providerData.providers]);
  useEffect(() => {
    commands.setSelectedProvider(providerData.currentProvider);
  }, [commands, providerData.currentProvider]);
  useEffect(() => {
    commands.setProfiles(profileData.profiles);
  }, [commands, profileData.profiles]);
  useEffect(() => {
    commands.setCreateProfileProviders(profileData.createProfileProviders);
  }, [commands, profileData.createProfileProviders]);
  useEffect(() => {
    commands.setProfileListItems(profileData.profileListItems);
  }, [commands, profileData.profileListItems]);
  useEffect(() => {
    commands.setProfileDialogLoading(profileData.profileDialogLoading);
  }, [commands, profileData.profileDialogLoading]);
  useEffect(() => {
    commands.setSelectedProfileName(profileData.selectedProfileName);
  }, [commands, profileData.selectedProfileName]);
  useEffect(() => {
    commands.setSelectedProfileData(profileData.selectedProfileData);
  }, [commands, profileData.selectedProfileData]);
  useEffect(() => {
    commands.setDefaultProfileName(profileData.defaultProfileName);
  }, [commands, profileData.defaultProfileName]);
  useEffect(() => {
    commands.setActiveProfileName(profileData.activeProfileName);
  }, [commands, profileData.activeProfileName]);
  useEffect(() => {
    commands.setProfileDialogError(profileData.profileDialogError);
  }, [commands, profileData.profileDialogError]);
  useEffect(() => {
    commands.setToolsDialogAction(profileData.toolsDialogAction);
  }, [commands, profileData.toolsDialogAction]);
  useEffect(() => {
    commands.setToolsDialogTools(profileData.toolsDialogTools);
  }, [commands, profileData.toolsDialogTools]);
  useEffect(() => {
    commands.setToolsDialogDisabledTools(profileData.toolsDialogDisabledTools);
  }, [commands, profileData.toolsDialogDisabledTools]);
  useEffect(() => {
    commands.setErrorCount(errorCount);
  }, [commands, errorCount]);
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
  const st = useDialogsStoreState(params.terminalStore, params.settingsStore);
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
  useDialogDataSync(
    params.settingsStore,
    auth.welcome,
    auth.providerData,
    profiles.data,
    core.errorCount,
  );
  const [startupGuardsInitialized, setStartupGuardsInitialized] =
    useState(false);
  useEffect(() => {
    setStartupGuardsInitialized(true);
  }, []);
  return {
    // Input-surface commands (cross-hook command arguments)
    setDebugMessage: st.setDebugMessage,
    toggleCorgiMode: st.toggleCorgiMode,
    handleExternalEditorOpen: st.handleExternalEditorOpen,
    dispatchExtensionStateUpdate: core.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: core.addConfirmUpdateExtensionRequest,
    extensionsUpdateState: core.extensionsUpdateState,
    welcomeActions: auth.welcome.actions,
    triggerWelcomeAuth: auth.triggerWelcomeAuth,
    performMemoryRefresh: profiles.performMemoryRefresh,
    // Dialog domain handlers for the view command surface
    openProviderDialog: auth.openProviderDialog,
    handleThemeSelect: auth.handleThemeSelect,
    handleThemeHighlight: auth.handleThemeHighlight,
    handleAuthSelect: auth.handleAuthSelect,
    handleEditorSelect: auth.handleEditorSelect,
    handleProviderSelect: auth.handleProviderSelect,
    handleProfileSelect: profiles.handleProfileSelect,
    openLoadProfileDialog: profiles.openLoadProfileDialog,
    openCreateProfileDialog: profiles.openCreateProfileDialog,
    openProfileListDialog: profiles.openProfileListDialog,
    viewProfileDetail: profiles.viewProfileDetail,
    closeProfileDetailDialog: profiles.closeProfileDetailDialog,
    loadProfileFromDetail: profiles.loadProfileFromDetail,
    deleteProfileFromDetail: profiles.deleteProfileFromDetail,
    deleteProfileFromList: profiles.deleteProfileFromList,
    setProfileAsDefault: profiles.setProfileAsDefault,
    openProfileEditor: profiles.openProfileEditor,
    closeProfileEditor: profiles.closeProfileEditor,
    saveProfileFromEditor: profiles.saveProfileFromEditor,
    handleToolsSelect: profiles.handleToolsSelect,
    handleFolderTrustSelect: auth.handleFolderTrustSelect,
    onWorkspaceMigrationDialogOpen: core.onWorkspaceMigrationDialogOpen,
    startupGuardsInitialized,
  };
}

export type AppDialogsResult = ReturnType<typeof useAppDialogs>;
