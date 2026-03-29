/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useThemeCommand } from '../../../hooks/useThemeCommand.js';
import { useAuthCommand } from '../../../hooks/useAuthCommand.js';
import { useFolderTrust } from '../../../hooks/useFolderTrust.js';
import { useWelcomeOnboarding } from '../../../hooks/useWelcomeOnboarding.js';
import { useIdeTrustListener } from '../../../hooks/useIdeTrustListener.js';
import { useEditorSettings } from '../../../hooks/useEditorSettings.js';
import { useExtensionUpdates } from '../../../hooks/useExtensionUpdates.js';
import { useOAuthOrchestration } from '../../../hooks/useOAuthOrchestration.js';
import { useSettingsCommand } from '../../../hooks/useSettingsCommand.js';
import { useProviderDialog } from '../../../hooks/useProviderDialog.js';
import { useLoadProfileDialog } from '../../../hooks/useLoadProfileDialog.js';
import { useCreateProfileDialog } from '../../../hooks/useCreateProfileDialog.js';
import { useProfileManagement } from '../../../hooks/useProfileManagement.js';
import { useToolsDialog } from '../../../hooks/useToolsDialog.js';
import { useWorkspaceMigration } from '../../../hooks/useWorkspaceMigration.js';
import { useDialogOrchestration } from './useDialogOrchestration.js';
import { useDisplayPreferences } from './useDisplayPreferences.js';
import { useModelTracking } from './useModelTracking.js';
import { useIdeContextBridge } from './useIdeContextBridge.js';
import { useQueueErrorTimeout } from './useQueueErrorTimeout.js';
import { useIdeRestartHotkey } from './useIdeRestartHotkey.js';
import { useMemoryRefreshAction } from './useMemoryRefreshAction.js';
import { useModelRuntimeSync } from './useModelRuntimeSync.js';
import { useAppEventHandlers } from './useAppEventHandlers.js';
import type {
  Config,
  IdeContext,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../../../config/settings.js';
import type { AppState, AppAction } from '../../../reducers/appReducer.js';
import type { HistoryItem, ConsoleMessageItem } from '../../../types.js';

const QUEUE_ERROR_DISPLAY_DURATION_MS = 3000;

export interface AppDialogsParams {
  config: Config;
  settings: LoadedSettings;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  addItem: (item: Omit<HistoryItem, 'id'>, baseTimestamp?: number) => number;
  handleNewMessage: (message: ConsoleMessageItem) => void;
  recordingIntegration?: RecordingIntegration;
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>;
  runtime: {
    getActiveModelName: () => string;
    getCliOAuthManager: () => unknown;
  };
  consoleMessages: ConsoleMessageItem[];
  setLlxprtMdFileCount: (count: number) => void;
}

function useDialogsState() {
  const [staticKey, setStaticKey] = useState(0);
  const [constrainHeight, setConstrainHeight] = useState<boolean>(true);
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [themeError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [editorError] = useState<string | null>(null);
  const [footerHeight, setFooterHeight] = useState<number>(0);
  const [shellModeActive, setShellModeActive] = useState(false);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [ideContextState, setIdeContextState] = useState<
    IdeContext | undefined
  >();
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const [showIdeRestartPrompt, setShowIdeRestartPrompt] = useState(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [embeddedShellFocused, setEmbeddedShellFocused] = useState(false);
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(
    null,
  );
  // toggleCorgiMode is retained as a no-op interface required by slash commands;
  // the _corgiMode state it previously toggled was never read or rendered.
  const toggleCorgiMode = useCallback(() => {}, []);
  const handleExternalEditorOpen = useCallback(() => {}, []);
  const refreshStatic = useCallback(() => {
    setStaticKey((prev) => prev + 1);
  }, []);
  const handleEscapePromptChange = useCallback((show: boolean) => {
    setShowEscapePrompt(show);
  }, []);
  const handlePrivacyNoticeExit = useCallback(() => {
    setShowPrivacyNotice(false);
  }, []);
  return {
    staticKey,
    setStaticKey,
    constrainHeight,
    setConstrainHeight,
    refreshStatic,
    handleExternalEditorOpen,
    debugMessage,
    setDebugMessage,
    themeError,
    authError,
    setAuthError,
    editorError,
    footerHeight,
    setFooterHeight,
    shellModeActive,
    setShellModeActive,
    showPrivacyNotice,
    setShowPrivacyNotice,
    ideContextState,
    setIdeContextState,
    showEscapePrompt,
    setShowEscapePrompt,
    showIdeRestartPrompt,
    setShowIdeRestartPrompt,
    isProcessing,
    setIsProcessing,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    queueErrorMessage,
    setQueueErrorMessage,
    toggleCorgiMode,
    handleEscapePromptChange,
    handlePrivacyNoticeExit,
  };
}

function useDialogsCore(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsState>,
) {
  const { config, settings, addItem, consoleMessages } = p;
  const { currentModel, setCurrentModel } = useModelTracking({ config });
  const displayPrefs = useDisplayPreferences();
  const orchestration = useDialogOrchestration();
  const workspace = useWorkspaceMigration(settings);
  const extensions = config.getExtensions();
  const extUpdates = useExtensionUpdates(
    extensions,
    addItem,
    config.getWorkingDir(),
  );
  useIdeContextBridge({ setIdeContextState: st.setIdeContextState });
  const openPrivacyNotice = useCallback(() => {
    st.setShowPrivacyNotice(true);
  }, [st]);
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
    ...displayPrefs,
    ...orchestration,
    ...workspace,
    ...extUpdates,
    openPrivacyNotice,
    errorCount,
  };
}

function useIdeTrustEffect(
  config: AppDialogsParams['config'],
  st: ReturnType<typeof useDialogsState>,
) {
  const { needsRestart: ideNeedsRestart } = useIdeTrustListener(config);
  useEffect(() => {
    if (ideNeedsRestart) st.setShowIdeRestartPrompt(true);
  }, [ideNeedsRestart, st]);
  useQueueErrorTimeout({
    queueErrorMessage: st.queueErrorMessage,
    setQueueErrorMessage: st.setQueueErrorMessage,
    timeoutMs: QUEUE_ERROR_DISPLAY_DURATION_MS,
  });
  useIdeRestartHotkey({ isActive: st.showIdeRestartPrompt });
}

function useDialogsAuthProviders(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsState>,
  currentModel: string,
  setCurrentModel: (model: string) => void,
  setShowErrorDetails: (value: boolean) => void,
) {
  const {
    config,
    settings,
    appState,
    appDispatch,
    addItem,
    handleNewMessage,
    recordingIntegration,
    runtime,
  } = p;
  const auth = useAuthCommand(settings, appState);
  const isOAuthCodeDialogOpen = appState.openDialogs.oauthCode;
  useOAuthOrchestration({ appDispatch, isOAuthCodeDialogOpen });
  const editor = useEditorSettings(settings, appState, addItem);
  const provider = useProviderDialog({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    appState,
    config,
    recordingIntegration,
  });
  useModelRuntimeSync({
    config,
    currentModel,
    setCurrentModel,
    getActiveModelName: runtime.getActiveModelName,
  });
  useAppEventHandlers({
    handleNewMessage,
    setShowErrorDetails,
    setConstrainHeight: st.setConstrainHeight,
  });
  return {
    isAuthDialogOpen: auth.isAuthDialogOpen,
    openAuthDialog: auth.openAuthDialog,
    handleAuthSelect: auth.handleAuthSelect,
    isOAuthCodeDialogOpen,
    isEditorDialogOpen: editor.isEditorDialogOpen,
    openEditorDialog: editor.openEditorDialog,
    handleEditorSelect: editor.handleEditorSelect,
    exitEditorDialog: editor.exitEditorDialog,
    isProviderDialogOpen: provider.showDialog,
    openProviderDialog: provider.openDialog,
    handleProviderSelect: provider.handleSelect,
    exitProviderDialog: provider.closeDialog,
    providerOptions: provider.providers,
    selectedProvider: provider.currentProvider,
  };
}

function useDialogsAuth(
  p: AppDialogsParams,
  st: ReturnType<typeof useDialogsState>,
  currentModel: string,
  setCurrentModel: (model: string) => void,
  setShowErrorDetails: (value: boolean) => void,
) {
  const { config, settings, appState, addItem } = p;
  const theme = useThemeCommand(settings, appState, addItem);
  const settingsCmd = useSettingsCommand();
  const folderTrust = useFolderTrust(settings, config, addItem);
  const welcome = useWelcomeOnboarding({
    settings,
    isFolderTrustComplete:
      !folderTrust.isFolderTrustDialogOpen && !folderTrust.isRestarting,
  });
  useIdeTrustEffect(config, st);
  const authProviders = useDialogsAuthProviders(
    p,
    st,
    currentModel,
    setCurrentModel,
    setShowErrorDetails,
  );
  return {
    isThemeDialogOpen: theme.isThemeDialogOpen,
    openThemeDialog: theme.openThemeDialog,
    handleThemeSelect: theme.handleThemeSelect,
    handleThemeHighlight: theme.handleThemeHighlight,
    isSettingsDialogOpen: settingsCmd.isSettingsDialogOpen,
    openSettingsDialog: settingsCmd.openSettingsDialog,
    closeSettingsDialog: settingsCmd.closeSettingsDialog,
    isFolderTrustDialogOpen: folderTrust.isFolderTrustDialogOpen,
    handleFolderTrustSelect: folderTrust.handleFolderTrustSelect,
    isRestarting: folderTrust.isRestarting,
    isWelcomeDialogOpen: welcome.showWelcome,
    welcomeState: welcome.state,
    welcomeActions: welcome.actions,
    welcomeAvailableProviders: welcome.availableProviders,
    welcomeAvailableModels: welcome.availableModels,
    triggerWelcomeAuth: welcome.triggerAuth,
    ...authProviders,
  };
}

function useDialogsProfiles(p: AppDialogsParams) {
  const { config, settings, appState, addItem, setLlxprtMdFileCount } = p;
  const loadProfile = useLoadProfileDialog({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    appState,
    config,
    settings,
  });
  const createProfile = useCreateProfileDialog({ appState });
  const profileMgmt = useProfileManagement({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    appState,
  });
  const toolsRaw = useToolsDialog({
    addMessage: (msg) =>
      addItem({ type: msg.type, text: msg.content }, msg.timestamp.getTime()),
    appState,
    config,
  });
  const openToolsDialog = useCallback(
    (action: 'enable' | 'disable') => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      toolsRaw.openDialog(action);
    },
    [toolsRaw],
  );
  const performMemoryRefresh = useMemoryRefreshAction({
    config,
    settings,
    addItem,
    setLlxprtMdFileCount,
  });
  const useAlternateBuffer =
    settings.merged.ui?.useAlternateBuffer === true &&
    !config.getScreenReader();
  return {
    isLoadProfileDialogOpen: loadProfile.showDialog,
    openLoadProfileDialog: loadProfile.openDialog,
    handleProfileSelect: loadProfile.handleSelect,
    exitLoadProfileDialog: loadProfile.closeDialog,
    profiles: loadProfile.profiles,
    isCreateProfileDialogOpen: createProfile.showDialog,
    openCreateProfileDialog: createProfile.openDialog,
    exitCreateProfileDialog: createProfile.closeDialog,
    createProfileProviders: createProfile.providers,
    isProfileListDialogOpen: profileMgmt.showListDialog,
    isProfileDetailDialogOpen: profileMgmt.showDetailDialog,
    isProfileEditorDialogOpen: profileMgmt.showEditorDialog,
    profileListItems: profileMgmt.profiles,
    profileDialogLoading: profileMgmt.isLoading,
    selectedProfileName: profileMgmt.selectedProfileName,
    selectedProfileData: profileMgmt.selectedProfile,
    defaultProfileName: profileMgmt.defaultProfileName,
    activeProfileName: profileMgmt.activeProfileName,
    profileDialogError: profileMgmt.profileError,
    openProfileListDialog: profileMgmt.openListDialog,
    closeProfileListDialog: profileMgmt.closeListDialog,
    viewProfileDetail: profileMgmt.viewProfileDetail,
    closeProfileDetailDialog: profileMgmt.closeDetailDialog,
    loadProfileFromDetail: profileMgmt.loadProfile,
    deleteProfileFromDetail: profileMgmt.deleteProfile,
    setProfileAsDefault: profileMgmt.setDefault,
    openProfileEditor: profileMgmt.openEditor,
    closeProfileEditor: profileMgmt.closeEditor,
    saveProfileFromEditor: profileMgmt.saveProfile,
    isToolsDialogOpen: toolsRaw.showDialog,
    openToolsDialog,
    exitToolsDialog: toolsRaw.closeDialog,
    toolsDialogAction: toolsRaw.action,
    toolsDialogTools: toolsRaw.availableTools,
    toolsDialogDisabledTools: toolsRaw.disabledTools,
    handleToolsSelect: toolsRaw.handleSelect,
    performMemoryRefresh,
    useAlternateBuffer,
  };
}

export function useAppDialogs(params: AppDialogsParams) {
  const st = useDialogsState();
  const core = useDialogsCore(params, st);
  const auth = useDialogsAuth(
    params,
    st,
    core.currentModel,
    core.setCurrentModel,
    core.setShowErrorDetails,
  );
  const profiles = useDialogsProfiles(params);
  return { ...st, ...core, ...auth, ...profiles };
}

export type AppDialogsResult = ReturnType<typeof useAppDialogs>;
