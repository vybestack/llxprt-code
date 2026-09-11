/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStore, type Store } from '../createStore.js';
import type { ApprovalMode, IdeContext } from '@vybestack/llxprt-code-core';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { ConsoleMessageItem } from '../../types.js';
import type { SlashCommand } from '../../commands/types.js';
import type {
  ModelInfo,
  WelcomeState,
} from '../../hooks/useWelcomeOnboarding.js';

/** One row of the profile list dialog. */
export interface ProfileListItem {
  name: string;
  type: 'standard' | 'loadbalancer';
  provider?: string;
  model?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

/** Footer token readout, mirrored from the session-stats trackers. */
export interface TokenMetricsSnapshot {
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  sessionTokenTotal: number;
}

/**
 * Settings/model/profile projection for the interactive UI: the current model
 * identity, provider and profile dialog data, the slash command registry,
 * welcome-onboarding data, and the status readouts the footer renders. This is
 * the terminal slice-D store: it holds the surviving UIState data members that
 * are neither dialog-open state (DialogStore), terminal/composer plane
 * (TerminalStore), nor streamed turn data (TurnStore). Writers are the domain
 * hooks via mirror effects; components read through useStoreSelector with
 * narrow selectors.
 */
export interface SettingsProfileState {
  // Model/provider projection
  currentModel: string;
  currentModelLabel: string | undefined;
  contextLimit: number | undefined;
  providerOptions: string[];
  createProfileProviders: string[];
  selectedProvider: string;

  // Load-profile and profile-management dialog data
  profiles: string[];
  profileListItems: ProfileListItem[];
  selectedProfileName: string | null;
  selectedProfileData: Profile | null;
  defaultProfileName: string | null;
  activeProfileName: string | null;
  profileDialogError: string | null;
  profileDialogLoading: boolean;

  // Tools dialog open-time data
  toolsDialogAction: 'enable' | 'disable';
  toolsDialogTools: ToolInfo[];
  toolsDialogDisabledTools: string[];

  // Slash command registry projection
  slashCommands: readonly SlashCommand[] | undefined;

  // Welcome onboarding wizard data
  welcomeState: WelcomeState;
  welcomeAvailableProviders: string[];
  welcomeAvailableModels: ModelInfo[];

  // IDE + memory context projection
  ideContextState: IdeContext | undefined;
  llxprtMdFileCount: number;
  coreMemoryFileCount: number;

  // Status readouts
  consoleMessages: ConsoleMessageItem[];
  errorCount: number;
  branchName: string | undefined;
  branchIsDirty: boolean;
  debugMessage: string;
  authError: string | null;
  initError: string | null;
  showAutoAcceptIndicator: ApprovalMode;
  tokenMetrics: TokenMetricsSnapshot;
  historyTokenCount: number;

  /** Incremented when CoreEvent.SettingsChanged fires. */
  settingsNonce: number;
}

export interface SettingsProfileCommands {
  setCurrentModel: (model: string) => void;
  setCurrentModelLabel: (label: string | undefined) => void;
  setContextLimit: (limit: number | undefined) => void;
  setProviderOptions: (providers: string[]) => void;
  setCreateProfileProviders: (providers: string[]) => void;
  setSelectedProvider: (provider: string) => void;
  setProfiles: (profiles: string[]) => void;
  setProfileListItems: (items: ProfileListItem[]) => void;
  setSelectedProfileName: (name: string | null) => void;
  setSelectedProfileData: (profile: Profile | null) => void;
  setDefaultProfileName: (name: string | null) => void;
  setActiveProfileName: (name: string | null) => void;
  setProfileDialogError: (error: string | null) => void;
  setProfileDialogLoading: (loading: boolean) => void;
  setToolsDialogAction: (action: 'enable' | 'disable') => void;
  setToolsDialogTools: (tools: ToolInfo[]) => void;
  setToolsDialogDisabledTools: (tools: string[]) => void;
  setSlashCommands: (commands: readonly SlashCommand[] | undefined) => void;
  setWelcomeState: (state: WelcomeState) => void;
  setWelcomeAvailableProviders: (providers: string[]) => void;
  setWelcomeAvailableModels: (models: ModelInfo[]) => void;
  setIdeContextState: (context: IdeContext | undefined) => void;
  setLlxprtMdFileCount: (count: number) => void;
  setCoreMemoryFileCount: (count: number) => void;
  setConsoleMessages: (messages: ConsoleMessageItem[]) => void;
  setErrorCount: (count: number) => void;
  setBranchInfo: (branchName: string | undefined, isDirty: boolean) => void;
  setDebugMessage: (message: string) => void;
  setAuthError: (error: string | null) => void;
  setInitError: (error: string | null) => void;
  setShowAutoAcceptIndicator: (mode: ApprovalMode) => void;
  setTokenMetrics: (metrics: TokenMetricsSnapshot) => void;
  setHistoryTokenCount: (count: number) => void;
  bumpSettingsNonce: () => void;
}

export interface SettingsProfileStore {
  store: Store<SettingsProfileState>;
  commands: SettingsProfileCommands;
}

function initialSettingsProfileState(): SettingsProfileState {
  return {
    currentModel: '',
    currentModelLabel: undefined,
    contextLimit: undefined,
    providerOptions: [],
    createProfileProviders: [],
    selectedProvider: '',
    profiles: [],
    profileListItems: [],
    selectedProfileName: null,
    selectedProfileData: null,
    defaultProfileName: null,
    activeProfileName: null,
    profileDialogError: null,
    profileDialogLoading: false,
    toolsDialogAction: 'enable',
    toolsDialogTools: [],
    toolsDialogDisabledTools: [],
    slashCommands: undefined,
    welcomeState: {
      step: 'welcome',
      authInProgress: false,
      modelsLoadStatus: 'idle',
    },
    welcomeAvailableProviders: [],
    welcomeAvailableModels: [],
    ideContextState: undefined,
    llxprtMdFileCount: 0,
    coreMemoryFileCount: 0,
    consoleMessages: [],
    errorCount: 0,
    branchName: undefined,
    branchIsDirty: false,
    debugMessage: '',
    authError: null,
    initError: null,
    showAutoAcceptIndicator: 'default' as ApprovalMode,
    tokenMetrics: {
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      sessionTokenTotal: 0,
    },
    historyTokenCount: 0,
    settingsNonce: 0,
  };
}

export function createSettingsProfileStore(
  initial?: Partial<SettingsProfileState>,
): SettingsProfileStore {
  const store = createStore<SettingsProfileState>({
    ...initialSettingsProfileState(),
    ...initial,
  });

  const assign = <K extends keyof SettingsProfileState>(
    key: K,
    value: SettingsProfileState[K],
  ): void => {
    // Equal value: a true no-op — createStore.setState notifies unconditionally,
    // so the write must be skipped here to keep subscribers quiet.
    if (store.getState()[key] === value) {
      return;
    }
    store.setState((prev) => ({ ...prev, [key]: value }));
  };

  const commands: SettingsProfileCommands = {
    setCurrentModel: (model) => assign('currentModel', model),
    setCurrentModelLabel: (label) => assign('currentModelLabel', label),
    setContextLimit: (limit) => assign('contextLimit', limit),
    setProviderOptions: (providers) => assign('providerOptions', providers),
    setCreateProfileProviders: (providers) =>
      assign('createProfileProviders', providers),
    setSelectedProvider: (provider) => assign('selectedProvider', provider),
    setProfiles: (profiles) => assign('profiles', profiles),
    setProfileListItems: (items) => assign('profileListItems', items),
    setSelectedProfileName: (name) => assign('selectedProfileName', name),
    setSelectedProfileData: (profile) => assign('selectedProfileData', profile),
    setDefaultProfileName: (name) => assign('defaultProfileName', name),
    setActiveProfileName: (name) => assign('activeProfileName', name),
    setProfileDialogError: (error) => assign('profileDialogError', error),
    setProfileDialogLoading: (loading) =>
      assign('profileDialogLoading', loading),
    setToolsDialogAction: (action) => assign('toolsDialogAction', action),
    setToolsDialogTools: (tools) => assign('toolsDialogTools', tools),
    setToolsDialogDisabledTools: (tools) =>
      assign('toolsDialogDisabledTools', tools),
    setSlashCommands: (slashCommands) => assign('slashCommands', slashCommands),
    setWelcomeState: (welcomeState) => assign('welcomeState', welcomeState),
    setWelcomeAvailableProviders: (providers) =>
      assign('welcomeAvailableProviders', providers),
    setWelcomeAvailableModels: (models) =>
      assign('welcomeAvailableModels', models),
    setIdeContextState: (ideContextState) =>
      assign('ideContextState', ideContextState),
    setLlxprtMdFileCount: (count) => assign('llxprtMdFileCount', count),
    setCoreMemoryFileCount: (count) => assign('coreMemoryFileCount', count),
    setConsoleMessages: (messages) => assign('consoleMessages', messages),
    setErrorCount: (count) => assign('errorCount', count),
    setBranchInfo: (branchName, branchIsDirty) => {
      const prev = store.getState();
      if (
        prev.branchName === branchName &&
        prev.branchIsDirty === branchIsDirty
      ) {
        return;
      }
      store.setState((p) => ({ ...p, branchName, branchIsDirty }));
    },
    setDebugMessage: (message) => assign('debugMessage', message),
    setAuthError: (error) => assign('authError', error),
    setInitError: (error) => assign('initError', error),
    setShowAutoAcceptIndicator: (mode) =>
      assign('showAutoAcceptIndicator', mode),
    setTokenMetrics: (metrics) => assign('tokenMetrics', metrics),
    setHistoryTokenCount: (count) => assign('historyTokenCount', count),
    bumpSettingsNonce: () =>
      store.setState((prev) => ({
        ...prev,
        settingsNonce: prev.settingsNonce + 1,
      })),
  };

  return { store, commands };
}
