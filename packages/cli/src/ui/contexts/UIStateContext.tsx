/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { createContext, useContext } from 'react';
import type { DOMElement } from 'ink';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import type {
  HistoryItem,
  HistoryItemWithoutId,
  ConsoleMessageItem,
  StreamingState,
  ActiveHook,
} from '../types.js';
import type {
  IdeContext,
  ApprovalMode,
  ThoughtSummary,
  IdeInfo,
} from '@vybestack/llxprt-code-core';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { SlashCommandRuntime } from '../cliUiRuntime.js';
import type { QueuedSubmission } from '../hooks/agentStream/types.js';
import type { SlashCommand, CommandContext } from '../commands/types.js';

import type { LoadedSettings } from '../../config/settings.js';
import type { WelcomeState, ModelInfo } from '../hooks/useWelcomeOnboarding.js';

/**
 * UI State shape for the AppContainer architecture.
 * This consolidates all UI state that was previously scattered across
 * the monolithic App.tsx component.
 */
export interface UIState {
  // Core app context
  slashCommandRuntime: SlashCommandRuntime;
  settings: LoadedSettings;

  // Terminal background color (dimensions/focus/capabilities live in the
  // TerminalStore)
  terminalBackgroundColor?: string;

  // History and streaming
  history: HistoryItem[];
  pendingHistoryItems: HistoryItemWithoutId[];
  streamingState: StreamingState;
  thought: ThoughtSummary | null;

  // Input buffer
  buffer: TextBuffer;
  shellModeActive: boolean;

  // Dialog data
  providerOptions: string[];
  /** Providers offered by the profile-create wizard (createProfile dialog). */
  createProfileProviders: string[];
  selectedProvider: string;
  currentModel: string;
  currentModelLabel?: string;
  contextLimit: number | undefined;
  profiles: string[];
  toolsDialogAction: 'enable' | 'disable';
  toolsDialogTools: ToolInfo[];
  toolsDialogDisabledTools: string[];

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
  selectedProfileData: Profile | null;
  defaultProfileName: string | null;
  activeProfileName: string | null;
  profileDialogError: string | null;
  profileDialogLoading: boolean;

  // Exit/warning states
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  showEscapePrompt: boolean;
  quittingMessages: HistoryItem[] | null;

  // Display options
  isTodoPanelCollapsed: boolean;
  isQueuedMessagesPanelCollapsed: boolean;
  queuedSubmissions: readonly QueuedSubmission[];
  vimModeEnabled: boolean;
  vimMode: string | undefined;

  // Context and status
  ideContextState: IdeContext | undefined;
  llxprtMdFileCount: number;
  coreMemoryFileCount: number;
  branchName: string | undefined;
  branchIsDirty: boolean;
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

  // Refs for flicker detection
  rootUiRef: React.RefObject<DOMElement | null>;
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;

  // Slash commands
  slashCommands: readonly SlashCommand[] | undefined;
  commandContext: CommandContext;

  // IDE context (prompt open state lives in DialogStore)
  currentIDE: IdeInfo | undefined;

  // Trust
  isTrustedFolder: boolean;

  // Welcome onboarding (dialog open state lives in DialogStore)
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

  // Placeholder text
  placeholder: string;

  // Queue error message (displayed when slash/shell commands cannot be queued)
  queueErrorMessage: string | null;

  // Markdown rendering toggle (alt+m)
  renderMarkdown: boolean;

  // Interactive shell focus state
  activeShellPtyId: number | null;
  embeddedShellFocused: boolean;

  // Settings reload nonce (incremented when skills/settings change)
  settingsNonce: number;
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
