/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { buildUIState, type UIStateParams } from './buildUIState.js';
import { StreamingState } from '../../../types.js';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { CommandContext } from '../../../commands/types.js';

const makeParams = (): UIStateParams => ({
  // Core app context
  slashCommandRuntime: {} as UIStateParams['slashCommandRuntime'],
  settings: {} as UIStateParams['settings'],
  settingsNonce: 0,

  // History and streaming
  history: [],
  pendingHistoryItems: [],
  streamingState: StreamingState.Idle,
  thought: null,

  // Input buffer
  buffer: {} as UIStateParams['buffer'],
  shellModeActive: false,

  // Dialog data (open state and open-time payloads live in DialogStore)
  providerOptions: [],
  selectedProvider: '',
  currentModel: '',
  currentModelLabel: undefined,
  contextLimit: undefined,
  profiles: [],
  toolsDialogAction: 'enable',
  toolsDialogTools: [],
  toolsDialogDisabledTools: [],

  // Profile management dialog data
  profileListItems: [],
  selectedProfileName: null,
  selectedProfileData: null,
  defaultProfileName: null,
  createProfileProviders: [],
  activeProfileName: null,
  profileDialogError: null,
  profileDialogLoading: false,

  // Exit/warning states
  ctrlCPressedOnce: false,
  ctrlDPressedOnce: false,
  showEscapePrompt: false,
  quittingMessages: null,

  // Display options
  isTodoPanelCollapsed: false,
  isQueuedMessagesPanelCollapsed: false,
  queuedSubmissions: [],
  vimModeEnabled: false,
  vimMode: undefined,

  // Context and status
  ideContextState: undefined,
  llxprtMdFileCount: 0,
  coreMemoryFileCount: 0,
  branchName: undefined,
  branchIsDirty: false,
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

  // Refs for flicker detection
  rootUiRef: { current: null },
  pendingHistoryItemRef: { current: null },

  // Slash commands
  slashCommands: undefined,
  commandContext: {} as CommandContext,

  // IDE prompt (open state lives in DialogStore)
  currentIDE: undefined,

  // Trust
  isTrustedFolder: false,

  // Welcome onboarding (dialog open state lives in DialogStore)
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

  // Placeholder text
  placeholder: '',

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

    expect(result.slashCommandRuntime).toBe(params.slashCommandRuntime);
    expect(result.settings).toBe(params.settings);
    expect(result.settingsNonce).toBe(0);
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
    expect(result.rootUiRef).toBe(params.rootUiRef);
    expect(result.pendingHistoryItemRef).toBe(params.pendingHistoryItemRef);
    expect(result.commandContext).toBe(params.commandContext);
    expect(result.inputHistory).toBe(params.inputHistory);
    expect(result.staticKey).toBe(0);
    expect(result.debugMessage).toBe('');
    expect(result.showDebugProfiler).toBe(false);
    expect(result.placeholder).toBe('');
    expect(result.queueErrorMessage).toBeNull();
    expect(result.renderMarkdown).toBe(false);
    expect(result.activeShellPtyId).toBeNull();
    expect(result.embeddedShellFocused).toBe(false);
  });

  it('passes selected profile data through unchanged', () => {
    const profile: Profile = {
      version: 1,
      provider: 'test-provider',
      model: 'test-model',
      modelParams: {},
      ephemeralSettings: {},
    };
    const params = makeParams();
    params.selectedProfileData = profile;

    const result = buildUIState(params);

    expect(result.selectedProfileData).toBe(profile);

    const paramsWithoutProfile = makeParams();
    const resultWithoutProfile = buildUIState(paramsWithoutProfile);

    expect(resultWithoutProfile.selectedProfileData).toBe(null);
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
      activeHooks: undefined,
    };
    const result = buildUIState(params);
    const actualKeys = Object.keys(result).sort();
    const expectedKeys = Object.keys(params).sort();
    expect(actualKeys).toStrictEqual(expectedKeys);
  });
});
