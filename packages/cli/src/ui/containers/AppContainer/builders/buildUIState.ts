/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DOMElement } from 'ink';
import type { TextBuffer } from '../../../components/shared/text-buffer.js';
import type {
  HistoryItem,
  HistoryItemWithoutId,
  ConsoleMessageItem,
  StreamingState,
  ConfirmationRequest,
  ActiveHook,
} from '../../../types.js';
import type {
  IdeContext,
  ApprovalMode,
  AnyDeclarativeTool,
  ThoughtSummary,
  IdeInfo,
  Config,
  GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import type { SlashCommand, CommandContext } from '../../../commands/types.js';
import type { LoadedSettings } from '../../../../config/settings.js';
import type {
  WelcomeState,
  ModelInfo,
} from '../../../hooks/useWelcomeOnboarding.js';
import type { SubagentView } from '../../../components/SubagentManagement/types.js';
import type { UIState } from '../../../contexts/UIStateContext.js';

/**
 * Parameters for buildUIState - all primitives extracted from hooks and state
 */
export interface UIStateParams {
  // Core app context
  config: Config;
  settings: LoadedSettings;
  settingsNonce: number;

  // Terminal dimensions
  terminalWidth: number;
  terminalHeight: number;
  mainAreaWidth: number;
  inputWidth: number;
  suggestionsWidth: number;
  terminalBackgroundColor?: string;

  // History and streaming
  history: HistoryItem[];
  pendingHistoryItems: HistoryItemWithoutId[];
  streamingState: StreamingState;
  thought: ThoughtSummary | null;

  // Input buffer
  buffer: TextBuffer;
  shellModeActive: boolean;

  // Dialog states
  isThemeDialogOpen: boolean;
  isSettingsDialogOpen: boolean;
  isAuthDialogOpen: boolean;
  isEditorDialogOpen: boolean;
  isProviderDialogOpen: boolean;
  isLoadProfileDialogOpen: boolean;
  isCreateProfileDialogOpen: boolean;
  isProfileListDialogOpen: boolean;
  isProfileDetailDialogOpen: boolean;
  isProfileEditorDialogOpen: boolean;
  isToolsDialogOpen: boolean;
  isFolderTrustDialogOpen: boolean;
  showWorkspaceMigrationDialog: boolean;
  showPrivacyNotice: boolean;
  isOAuthCodeDialogOpen: boolean;
  isPermissionsDialogOpen: boolean;
  isLoggingDialogOpen: boolean;
  isSubagentDialogOpen: boolean;
  isModelsDialogOpen: boolean;
  isSessionBrowserDialogOpen: boolean;

  // Dialog data
  providerOptions: string[];
  selectedProvider: string;
  currentModel: string;
  profiles: string[];
  toolsDialogAction: 'enable' | 'disable';
  toolsDialogTools: AnyDeclarativeTool[];
  toolsDialogDisabledTools: string[];
  workspaceGeminiCLIExtensions: GeminiCLIExtension[];
  loggingDialogData: { entries: unknown[] };
  subagentDialogInitialView?: SubagentView;
  subagentDialogInitialName?: string;
  modelsDialogData?: {
    initialSearch?: string;
    initialFilters?: {
      tools?: boolean;
      vision?: boolean;
      reasoning?: boolean;
      audio?: boolean;
    };
    includeDeprecated?: boolean;
    providerOverride?: string | null;
    showAllProviders?: boolean;
  };

  // Profile management dialog data
  profileListItems: Array<{
    name: string;
    type: 'standard' | 'loadbalancer';
    provider?: string;
    model?: string;
    isDefault?: boolean;
    isActive?: boolean;
  }>;
  selectedProfileName: string | null;
  selectedProfileData: unknown | null;
  defaultProfileName: string | null;
  activeProfileName: string | null;
  profileDialogError: string | null;
  profileDialogLoading: boolean;

  // Confirmation requests
  confirmationRequest: {
    prompt: React.ReactNode;
    onConfirm: (value: boolean) => void;
  } | null;
  confirmUpdateGeminiCLIExtensionRequests: ConfirmationRequest[];

  // Exit/warning states
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  showEscapePrompt: boolean;
  showIdeRestartPrompt: boolean;
  quittingMessages: HistoryItem[] | null;

  // Display options
  constrainHeight: boolean;
  showErrorDetails: boolean;
  showToolDescriptions: boolean;
  isTodoPanelCollapsed: boolean;
  isNarrow: boolean;
  vimModeEnabled: boolean;
  vimMode: string | undefined;

  // Context and status
  ideContextState: IdeContext | undefined;
  llxprtMdFileCount: number;
  coreMemoryFileCount: number;
  branchName: string | undefined;
  errorCount: number;
  activeHooks?: ActiveHook[];

  // Console and messages
  consoleMessages: ConsoleMessageItem[];

  // Loading and status
  elapsedTime: number;
  currentLoadingPhrase: string | undefined;
  showAutoAcceptIndicator: ApprovalMode;

  // Token metrics
  tokenMetrics: {
    tokensPerMinute: number;
    throttleWaitTimeMs: number;
    sessionTokenTotal: number;
  };
  historyTokenCount: number;

  // Error states
  initError: string | null;
  authError: string | null;
  themeError: string | null;
  editorError: string | null;

  // Processing states
  isProcessing: boolean;
  isInputActive: boolean;
  isFocused: boolean;

  // Refs for flicker detection
  rootUiRef: React.RefObject<DOMElement | null>;
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;

  // Slash commands
  slashCommands: readonly SlashCommand[] | undefined;
  commandContext: CommandContext;

  // IDE prompt
  shouldShowIdePrompt: boolean;
  currentIDE: IdeInfo | undefined;

  // Trust
  isRestarting: boolean;
  isTrustedFolder: boolean;

  // Welcome onboarding
  isWelcomeDialogOpen: boolean;
  welcomeState: WelcomeState;
  welcomeAvailableProviders: string[];
  welcomeAvailableModels: ModelInfo[];

  // Input history
  inputHistory: string[];

  // Static key for refreshing
  staticKey: number;

  // Debug
  debugMessage: string;
  showDebugProfiler: boolean;

  // Copy mode
  copyModeEnabled: boolean;

  // Footer height
  footerHeight: number;

  // Placeholder text
  placeholder: string;

  // Available terminal height for content
  availableTerminalHeight: number;

  // Queue error message
  queueErrorMessage: string | null;

  // Markdown rendering toggle
  renderMarkdown: boolean;

  // Interactive shell focus state
  activeShellPtyId: number | null;
  embeddedShellFocused: boolean;
}

function buildCoreAndTerminal(p: UIStateParams) {
  return {
    config: p.config,
    settings: p.settings,
    settingsNonce: p.settingsNonce,
    terminalWidth: p.terminalWidth,
    terminalHeight: p.terminalHeight,
    mainAreaWidth: p.mainAreaWidth,
    inputWidth: p.inputWidth,
    suggestionsWidth: p.suggestionsWidth,
    terminalBackgroundColor: p.terminalBackgroundColor,
    history: p.history,
    pendingHistoryItems: p.pendingHistoryItems,
    streamingState: p.streamingState,
    thought: p.thought,
    buffer: p.buffer,
    shellModeActive: p.shellModeActive,
  };
}

function buildDialogStates(p: UIStateParams) {
  return {
    isThemeDialogOpen: p.isThemeDialogOpen,
    isSettingsDialogOpen: p.isSettingsDialogOpen,
    isAuthDialogOpen: p.isAuthDialogOpen,
    isEditorDialogOpen: p.isEditorDialogOpen,
    isProviderDialogOpen: p.isProviderDialogOpen,
    isLoadProfileDialogOpen: p.isLoadProfileDialogOpen,
    isCreateProfileDialogOpen: p.isCreateProfileDialogOpen,
    isProfileListDialogOpen: p.isProfileListDialogOpen,
    isProfileDetailDialogOpen: p.isProfileDetailDialogOpen,
    isProfileEditorDialogOpen: p.isProfileEditorDialogOpen,
    isToolsDialogOpen: p.isToolsDialogOpen,
    isFolderTrustDialogOpen: p.isFolderTrustDialogOpen,
    showWorkspaceMigrationDialog: p.showWorkspaceMigrationDialog,
    showPrivacyNotice: p.showPrivacyNotice,
    isOAuthCodeDialogOpen: p.isOAuthCodeDialogOpen,
    isPermissionsDialogOpen: p.isPermissionsDialogOpen,
    isLoggingDialogOpen: p.isLoggingDialogOpen,
    isSubagentDialogOpen: p.isSubagentDialogOpen,
    isModelsDialogOpen: p.isModelsDialogOpen,
    isSessionBrowserDialogOpen: p.isSessionBrowserDialogOpen,
  };
}

function buildDialogData(p: UIStateParams) {
  return {
    providerOptions: p.providerOptions,
    selectedProvider: p.selectedProvider,
    currentModel: p.currentModel,
    profiles: p.profiles,
    toolsDialogAction: p.toolsDialogAction,
    toolsDialogTools: p.toolsDialogTools,
    toolsDialogDisabledTools: p.toolsDialogDisabledTools,
    workspaceGeminiCLIExtensions: p.workspaceGeminiCLIExtensions,
    loggingDialogData: p.loggingDialogData,
    subagentDialogInitialView: p.subagentDialogInitialView,
    subagentDialogInitialName: p.subagentDialogInitialName,
    modelsDialogData: p.modelsDialogData,
    profileListItems: p.profileListItems,
    selectedProfileName: p.selectedProfileName,
    selectedProfileData: p.selectedProfileData,
    defaultProfileName: p.defaultProfileName,
    activeProfileName: p.activeProfileName,
    profileDialogError: p.profileDialogError,
    profileDialogLoading: p.profileDialogLoading,
  };
}

function buildConfirmationAndExit(p: UIStateParams) {
  return {
    confirmationRequest: p.confirmationRequest,
    confirmUpdateGeminiCLIExtensionRequests:
      p.confirmUpdateGeminiCLIExtensionRequests,
    ctrlCPressedOnce: p.ctrlCPressedOnce,
    ctrlDPressedOnce: p.ctrlDPressedOnce,
    showEscapePrompt: p.showEscapePrompt,
    showIdeRestartPrompt: p.showIdeRestartPrompt,
    quittingMessages: p.quittingMessages,
  };
}

function buildDisplayAndContext(p: UIStateParams) {
  return {
    constrainHeight: p.constrainHeight,
    showErrorDetails: p.showErrorDetails,
    showToolDescriptions: p.showToolDescriptions,
    isTodoPanelCollapsed: p.isTodoPanelCollapsed,
    isNarrow: p.isNarrow,
    vimModeEnabled: p.vimModeEnabled,
    vimMode: p.vimMode,
    ideContextState: p.ideContextState,
    llxprtMdFileCount: p.llxprtMdFileCount,
    coreMemoryFileCount: p.coreMemoryFileCount,
    branchName: p.branchName,
    errorCount: p.errorCount,
    activeHooks: p.activeHooks,
    consoleMessages: p.consoleMessages,
    elapsedTime: p.elapsedTime,
    currentLoadingPhrase: p.currentLoadingPhrase,
    showAutoAcceptIndicator: p.showAutoAcceptIndicator,
  };
}

function buildMetricsAndErrors(p: UIStateParams) {
  return {
    tokenMetrics: p.tokenMetrics,
    historyTokenCount: p.historyTokenCount,
    initError: p.initError,
    authError: p.authError,
    themeError: p.themeError,
    editorError: p.editorError,
  };
}

function buildProcessingAndCommands(p: UIStateParams) {
  return {
    isProcessing: p.isProcessing,
    isInputActive: p.isInputActive,
    isFocused: p.isFocused,
    rootUiRef: p.rootUiRef,
    pendingHistoryItemRef: p.pendingHistoryItemRef,
    slashCommands: p.slashCommands,
    commandContext: p.commandContext,
    shouldShowIdePrompt: p.shouldShowIdePrompt,
    currentIDE: p.currentIDE,
    isRestarting: p.isRestarting,
    isTrustedFolder: p.isTrustedFolder,
  };
}

function buildMiscState(p: UIStateParams) {
  return {
    isWelcomeDialogOpen: p.isWelcomeDialogOpen,
    welcomeState: p.welcomeState,
    welcomeAvailableProviders: p.welcomeAvailableProviders,
    welcomeAvailableModels: p.welcomeAvailableModels,
    inputHistory: p.inputHistory,
    staticKey: p.staticKey,
    debugMessage: p.debugMessage,
    showDebugProfiler: p.showDebugProfiler,
    copyModeEnabled: p.copyModeEnabled,
    footerHeight: p.footerHeight,
    placeholder: p.placeholder,
    availableTerminalHeight: p.availableTerminalHeight,
    queueErrorMessage: p.queueErrorMessage,
    renderMarkdown: p.renderMarkdown,
    activeShellPtyId: p.activeShellPtyId,
    embeddedShellFocused: p.embeddedShellFocused,
  };
}

/**
 * @builder buildUIState
 * @description Pure function assembling UIState from primitives
 * @inputs UIStateParams object with all primitive parameters
 * @outputs UIState object (plain, not memoized)
 * @sideEffects None
 * @strictMode N/A (pure function)
 */
export function buildUIState(params: UIStateParams): UIState {
  return {
    ...buildCoreAndTerminal(params),
    ...buildDialogStates(params),
    ...buildDialogData(params),
    ...buildConfirmationAndExit(params),
    ...buildDisplayAndContext(params),
    ...buildMetricsAndErrors(params),
    ...buildProcessingAndCommands(params),
    ...buildMiscState(params),
  } satisfies UIState;
}
