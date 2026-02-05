/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';
import type { DOMElement } from 'ink';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type {
  HistoryItem,
  HistoryItemWithoutId,
  ConsoleMessageItem,
  StreamingState,
  ConfirmationRequest,
} from '../types.js';
import type {
  IdeContext,
  ApprovalMode,
  AnyDeclarativeTool,
  ThoughtSummary,
  IdeInfo,
  Config,
  GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import type { SlashCommand, CommandContext } from '../commands/types.js';
import type { ShellConfirmationRequest } from '../components/ShellConfirmationDialog.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { WelcomeState, ModelInfo } from '../hooks/useWelcomeOnboarding.js';
import type { SubagentView } from '../components/SubagentManagement/types.js';

/**
 * UI State shape for the AppContainer architecture.
 * This consolidates all UI state that was previously scattered across
 * the monolithic App.tsx component.
 */
export interface UIState {
  // Core app context
  config: Config;
  settings: LoadedSettings;

  // Terminal dimensions
  terminalWidth: number;
  terminalHeight: number;
  mainAreaWidth: number;
  inputWidth: number;
  suggestionsWidth: number;

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
    /** Override provider filter from --provider arg */
    providerOverride?: string | null;
    /** Show all providers (from --all flag) */
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
  shellConfirmationRequest: ShellConfirmationRequest | null;
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
  branchName: string | undefined;
  errorCount: number;

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

  // Available terminal height for content (after footer measurement)
  availableTerminalHeight: number;

  // Queue error message (displayed when slash/shell commands cannot be queued)
  queueErrorMessage: string | null;

  // Markdown rendering toggle (alt+m)
  renderMarkdown: boolean;

  // Interactive shell focus state
  activeShellPtyId: number | null;
  embeddedShellFocused: boolean;
}

const UIStateContext = createContext<UIState | undefined>(undefined);

export function UIStateProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: UIState;
}) {
  return (
    <UIStateContext.Provider value={value}>{children}</UIStateContext.Provider>
  );
}

export function useUIState(): UIState {
  const context = useContext(UIStateContext);
  if (!context) {
    throw new Error('useUIState must be used within a UIStateProvider');
  }
  return context;
}

export { UIStateContext };
