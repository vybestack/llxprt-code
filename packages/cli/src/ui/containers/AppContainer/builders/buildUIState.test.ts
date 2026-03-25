/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildUIState, type UIStateParams } from './buildUIState.js';
import { StreamingState } from '../../../types.js';
import type { CommandContext } from '../../../commands/types.js';

const makeParams = (): UIStateParams => ({
  // Core app context
  config: {} as UIStateParams['config'],
  settings: {} as UIStateParams['settings'],
  settingsNonce: 0,

  // Terminal dimensions
  terminalWidth: 0,
  terminalHeight: 0,
  mainAreaWidth: 0,
  inputWidth: 0,
  suggestionsWidth: 0,

  // History and streaming
  history: [],
  pendingHistoryItems: [],
  streamingState: StreamingState.Idle,
  thought: null,

  // Input buffer
  buffer: {} as UIStateParams['buffer'],
  shellModeActive: false,

  // Dialog states
  isThemeDialogOpen: false,
  isSettingsDialogOpen: false,
  isAuthDialogOpen: false,
  isEditorDialogOpen: false,
  isProviderDialogOpen: false,
  isLoadProfileDialogOpen: false,
  isCreateProfileDialogOpen: false,
  isProfileListDialogOpen: false,
  isProfileDetailDialogOpen: false,
  isProfileEditorDialogOpen: false,
  isToolsDialogOpen: false,
  isFolderTrustDialogOpen: false,
  showWorkspaceMigrationDialog: false,
  showPrivacyNotice: false,
  isOAuthCodeDialogOpen: false,
  isPermissionsDialogOpen: false,
  isLoggingDialogOpen: false,
  isSubagentDialogOpen: false,
  isModelsDialogOpen: false,
  isSessionBrowserDialogOpen: false,

  // Dialog data
  providerOptions: [],
  selectedProvider: '',
  currentModel: '',
  profiles: [],
  toolsDialogAction: 'enable',
  toolsDialogTools: [],
  toolsDialogDisabledTools: [],
  workspaceGeminiCLIExtensions: [],
  loggingDialogData: { entries: [] },

  // Profile management dialog data
  profileListItems: [],
  selectedProfileName: null,
  selectedProfileData: null,
  defaultProfileName: null,
  activeProfileName: null,
  profileDialogError: null,
  profileDialogLoading: false,

  // Confirmation requests
  shellConfirmationRequest: null,
  confirmationRequest: null,
  confirmUpdateGeminiCLIExtensionRequests: [],

  // Exit/warning states
  ctrlCPressedOnce: false,
  ctrlDPressedOnce: false,
  showEscapePrompt: false,
  showIdeRestartPrompt: false,
  quittingMessages: null,

  // Display options
  constrainHeight: false,
  showErrorDetails: false,
  showToolDescriptions: false,
  isTodoPanelCollapsed: false,
  isNarrow: false,
  vimModeEnabled: false,
  vimMode: undefined,

  // Context and status
  ideContextState: undefined,
  llxprtMdFileCount: 0,
  coreMemoryFileCount: 0,
  branchName: undefined,
  errorCount: 0,

  // Console and messages
  consoleMessages: [],

  // Loading and status
  elapsedTime: 0,
  currentLoadingPhrase: undefined,
  showAutoAcceptIndicator: 'none' as UIStateParams['showAutoAcceptIndicator'],

  // Token metrics
  tokenMetrics: {
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    sessionTokenTotal: 0,
  },
  historyTokenCount: 0,

  // Error states
  initError: null,
  authError: null,
  themeError: null,
  editorError: null,

  // Processing states
  isProcessing: false,
  isInputActive: false,
  isFocused: false,

  // Refs for flicker detection
  rootUiRef: { current: null },
  pendingHistoryItemRef: { current: null },

  // Slash commands
  slashCommands: undefined,
  commandContext: {} as CommandContext,

  // IDE prompt
  shouldShowIdePrompt: false,
  currentIDE: undefined,

  // Trust
  isRestarting: false,
  isTrustedFolder: false,

  // Welcome onboarding
  isWelcomeDialogOpen: false,
  welcomeState: {} as UIStateParams['welcomeState'],
  welcomeAvailableProviders: [],
  welcomeAvailableModels: [],

  // Input history
  inputHistory: [],

  // Static key for refreshing
  staticKey: 0,

  // Debug
  debugMessage: '',
  showDebugProfiler: false,

  // Copy mode
  copyModeEnabled: false,

  // Footer height
  footerHeight: 0,

  // Placeholder text
  placeholder: '',

  // Available terminal height for content
  availableTerminalHeight: 0,

  // Queue error message
  queueErrorMessage: null,

  // Markdown rendering toggle
  renderMarkdown: false,

  // Interactive shell focus state
  activeShellPtyId: null,
  embeddedShellFocused: false,
});

describe('buildUIState', () => {
  it('produces an object containing every UIState key', () => {
    const params = makeParams();
    const result = buildUIState(params);

    expect(result.config).toBe(params.config);
    expect(result.settings).toBe(params.settings);
    expect(result.settingsNonce).toBe(0);
    expect(result.terminalWidth).toBe(0);
    expect(result.terminalHeight).toBe(0);
    expect(result.mainAreaWidth).toBe(0);
    expect(result.inputWidth).toBe(0);
    expect(result.suggestionsWidth).toBe(0);
    expect(result.history).toBe(params.history);
    expect(result.pendingHistoryItems).toBe(params.pendingHistoryItems);
    expect(result.streamingState).toBe(StreamingState.Idle);
    expect(result.thought).toBeNull();
    expect(result.buffer).toBe(params.buffer);
    expect(result.shellModeActive).toBe(false);
    expect(result.profileListItems).toBe(params.profileListItems);
    expect(result.consoleMessages).toBe(params.consoleMessages);
    expect(result.elapsedTime).toBe(0);
    expect(result.isProcessing).toBe(false);
    expect(result.isInputActive).toBe(false);
    expect(result.isFocused).toBe(false);
    expect(result.rootUiRef).toBe(params.rootUiRef);
    expect(result.pendingHistoryItemRef).toBe(params.pendingHistoryItemRef);
    expect(result.commandContext).toBe(params.commandContext);
    expect(result.inputHistory).toBe(params.inputHistory);
    expect(result.staticKey).toBe(0);
    expect(result.debugMessage).toBe('');
    expect(result.showDebugProfiler).toBe(false);
    expect(result.copyModeEnabled).toBe(false);
    expect(result.footerHeight).toBe(0);
    expect(result.placeholder).toBe('');
    expect(result.availableTerminalHeight).toBe(0);
    expect(result.queueErrorMessage).toBeNull();
    expect(result.renderMarkdown).toBe(false);
    expect(result.activeShellPtyId).toBeNull();
    expect(result.embeddedShellFocused).toBe(false);
  });

  it('maps dialog states correctly', () => {
    const params = makeParams();
    params.isThemeDialogOpen = true;
    params.isSettingsDialogOpen = true;
    params.isAuthDialogOpen = true;
    params.isEditorDialogOpen = true;
    params.isProviderDialogOpen = true;
    params.isLoadProfileDialogOpen = true;
    params.isCreateProfileDialogOpen = true;
    params.isProfileListDialogOpen = true;
    params.isProfileDetailDialogOpen = true;
    params.isProfileEditorDialogOpen = true;
    params.isToolsDialogOpen = true;
    params.isFolderTrustDialogOpen = true;
    params.showWorkspaceMigrationDialog = true;
    params.showPrivacyNotice = true;
    params.isOAuthCodeDialogOpen = true;
    params.isPermissionsDialogOpen = true;
    params.isLoggingDialogOpen = true;
    params.isSubagentDialogOpen = true;
    params.isModelsDialogOpen = true;
    params.isSessionBrowserDialogOpen = true;

    const result = buildUIState(params);

    expect(result.isThemeDialogOpen).toBe(true);
    expect(result.isSettingsDialogOpen).toBe(true);
    expect(result.isAuthDialogOpen).toBe(true);
    expect(result.isEditorDialogOpen).toBe(true);
    expect(result.isProviderDialogOpen).toBe(true);
    expect(result.isLoadProfileDialogOpen).toBe(true);
    expect(result.isCreateProfileDialogOpen).toBe(true);
    expect(result.isProfileListDialogOpen).toBe(true);
    expect(result.isProfileDetailDialogOpen).toBe(true);
    expect(result.isProfileEditorDialogOpen).toBe(true);
    expect(result.isToolsDialogOpen).toBe(true);
    expect(result.isFolderTrustDialogOpen).toBe(true);
    expect(result.showWorkspaceMigrationDialog).toBe(true);
    expect(result.showPrivacyNotice).toBe(true);
    expect(result.isOAuthCodeDialogOpen).toBe(true);
    expect(result.isPermissionsDialogOpen).toBe(true);
    expect(result.isLoggingDialogOpen).toBe(true);
    expect(result.isSubagentDialogOpen).toBe(true);
    expect(result.isModelsDialogOpen).toBe(true);
    expect(result.isSessionBrowserDialogOpen).toBe(true);
  });

  it('maps token metrics correctly', () => {
    const params = makeParams();
    params.tokenMetrics = {
      tokensPerMinute: 42,
      throttleWaitTimeMs: 100,
      sessionTokenTotal: 999,
    };
    params.historyTokenCount = 77;

    const result = buildUIState(params);

    expect(result.tokenMetrics).toStrictEqual({
      tokensPerMinute: 42,
      throttleWaitTimeMs: 100,
      sessionTokenTotal: 999,
    });
    expect(result.historyTokenCount).toBe(77);
  });

  it('output has exactly the known UIState keys — no extras, no omissions', () => {
    // Include all optional UIStateParams fields so Object.keys is symmetric
    const params: Parameters<typeof buildUIState>[0] = {
      ...makeParams(),
      terminalBackgroundColor: undefined,
      subagentDialogInitialView: undefined,
      subagentDialogInitialName: undefined,
      modelsDialogData: undefined,
      activeHooks: undefined,
    };
    const result = buildUIState(params);
    const actualKeys = Object.keys(result).sort();
    const expectedKeys = Object.keys(params).sort();
    expect(actualKeys).toStrictEqual(expectedKeys);
  });
});
