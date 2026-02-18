/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock ink to use real Ink with ink-testing-library
// The global mock in test-setup.ts conflicts with renderer behavior here.
vi.unmock('ink');

import { DefaultAppLayout } from './DefaultAppLayout.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { StreamingState } from '../types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';

const { dialogManagerRenderSpy, composerRenderSpy } = vi.hoisted(() => ({
  dialogManagerRenderSpy: vi.fn(() => null),
  composerRenderSpy: vi.fn(() => null),
}));

vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: vi.fn(),
}));

vi.mock('../contexts/UIActionsContext.js', () => ({
  useUIActions: vi.fn(),
}));

vi.mock('../components/DialogManager.js', () => ({
  DialogManager: dialogManagerRenderSpy,
}));

vi.mock('../components/Composer.js', () => ({
  Composer: composerRenderSpy,
}));

// Mock all other child components as null so this test only verifies
// dialog gating behavior in DefaultAppLayout.
vi.mock('../components/AppHeader.js', () => ({ AppHeader: () => null }));
vi.mock('../components/HistoryItemDisplay.js', () => ({
  HistoryItemDisplay: () => null,
}));
vi.mock('../components/ShowMoreLines.js', () => ({
  ShowMoreLines: () => null,
}));
vi.mock('../components/Notifications.js', () => ({
  Notifications: () => null,
}));
vi.mock('../components/TodoPanel.js', () => ({ TodoPanel: () => null }));
vi.mock('../components/Footer.js', () => ({ Footer: () => null }));
vi.mock('../components/BucketAuthConfirmation.js', () => ({
  BucketAuthConfirmation: () => null,
}));
vi.mock('../components/LoadingIndicator.js', () => ({
  LoadingIndicator: () => null,
}));
vi.mock('../components/AutoAcceptIndicator.js', () => ({
  AutoAcceptIndicator: () => null,
}));
vi.mock('../components/ShellModeIndicator.js', () => ({
  ShellModeIndicator: () => null,
}));
vi.mock('../components/ContextSummaryDisplay.js', () => ({
  ContextSummaryDisplay: () => null,
}));
vi.mock('../components/DetailedMessagesDisplay.js', () => ({
  DetailedMessagesDisplay: () => null,
}));
vi.mock('../components/shared/ScrollableList.js', () => ({
  ScrollableList: () => null,
}));
vi.mock('../components/shared/VirtualizedList.js', () => ({
  SCROLL_TO_ITEM_END: -1,
}));

const mockUseUIState = vi.mocked(useUIState);
const mockUseUIActions = vi.mocked(useUIActions);

function createConfigStub() {
  return {
    getScreenReader: () => false,
    getAccessibility: () => ({ disableLoadingPhrases: false }),
    getMcpServers: () => [],
    getBlockedMcpServers: () => [],
    getTargetDir: () => '/tmp',
    getDebugMode: () => false,
    getEphemeralSetting: () => undefined,
    isTrustedFolder: () => true,
  };
}

function createSettingsStub() {
  return {
    merged: {
      ui: {
        showTodoPanel: false,
        hideFooter: false,
        hideContextSummary: false,
        useAlternateBuffer: true,
      },
      hideCWD: false,
      hideSandboxStatus: false,
      hideModelInfo: false,
    },
  };
}

function createActionsStub() {
  return {
    addItem: vi.fn(),
    handleUserInputSubmit: vi.fn(),
    handleClearScreen: vi.fn(),
    setShellModeActive: vi.fn(),
    handleEscapePromptChange: vi.fn(),
    vimHandleInput: vi.fn(),
    setQueueErrorMessage: vi.fn(),
  };
}

function createBaseUIState() {
  return {
    terminalWidth: 120,
    terminalHeight: 40,
    mainAreaWidth: 120,
    inputWidth: 120,
    suggestionsWidth: 60,
    history: [],
    pendingHistoryItems: [],
    streamingState: StreamingState.Idle,
    quittingMessages: null,
    constrainHeight: false,
    showErrorDetails: false,
    showToolDescriptions: false,
    isTodoPanelCollapsed: false,
    consoleMessages: [],
    slashCommands: [],
    staticKey: 0,
    isInputActive: true,
    ctrlCPressedOnce: false,
    ctrlDPressedOnce: false,
    showEscapePrompt: false,
    ideContextState: undefined,
    llxprtMdFileCount: 0,
    elapsedTime: 0,
    currentLoadingPhrase: undefined,
    showAutoAcceptIndicator: ApprovalMode.DEFAULT,
    shellModeActive: false,
    thought: undefined,
    branchName: undefined,
    debugMessage: '',
    errorCount: 0,
    historyTokenCount: 0,
    vimModeEnabled: false,
    vimMode: undefined,
    tokenMetrics: {
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      sessionTokenTotal: 0,
    },
    currentModel: 'test-model',
    availableTerminalHeight: 40,
    activeShellPtyId: null,
    embeddedShellFocused: false,

    // dialog flags
    showWorkspaceMigrationDialog: false,
    shouldShowIdePrompt: false,
    showIdeRestartPrompt: false,
    isFolderTrustDialogOpen: false,
    isWelcomeDialogOpen: false,
    isPermissionsDialogOpen: false,
    shellConfirmationRequest: null,
    confirmationRequest: null,
    isThemeDialogOpen: false,
    isSettingsDialogOpen: false,
    isAuthDialogOpen: false,
    isOAuthCodeDialogOpen: false,
    isEditorDialogOpen: false,
    isProviderDialogOpen: false,
    isLoadProfileDialogOpen: false,
    isCreateProfileDialogOpen: false,
    isProfileListDialogOpen: false,
    isProfileDetailDialogOpen: false,
    isProfileEditorDialogOpen: false,
    isToolsDialogOpen: false,
    isLoggingDialogOpen: false,
    isSubagentDialogOpen: false,
    isModelsDialogOpen: false,
    isSessionBrowserDialogOpen: false,
    showPrivacyNotice: false,

    rootUiRef: { current: null },
    pendingHistoryItemRef: { current: null },
  };
}

describe('DefaultAppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUIActions.mockReturnValue(createActionsStub() as never);
  });

  it('renders DialogManager when session browser dialog is open', () => {
    mockUseUIState.mockReturnValue({
      ...createBaseUIState(),
      isSessionBrowserDialogOpen: true,
    } as never);

    render(
      <DefaultAppLayout
        config={createConfigStub() as never}
        settings={createSettingsStub() as never}
        startupWarnings={[]}
        version={'0.0.0-test'}
        nightly={false}
        mainControlsRef={{ current: null }}
        availableTerminalHeight={40}
        contextFileNames={[]}
        updateInfo={null}
      />,
    );

    expect(dialogManagerRenderSpy).toHaveBeenCalledTimes(1);
    expect(composerRenderSpy).not.toHaveBeenCalled();
  });

  it('renders Composer when no dialog is open', () => {
    mockUseUIState.mockReturnValue(createBaseUIState() as never);

    render(
      <DefaultAppLayout
        config={createConfigStub() as never}
        settings={createSettingsStub() as never}
        startupWarnings={[]}
        version={'0.0.0-test'}
        nightly={false}
        mainControlsRef={{ current: null }}
        availableTerminalHeight={40}
        contextFileNames={[]}
        updateInfo={null}
      />,
    );

    expect(composerRenderSpy).toHaveBeenCalledTimes(1);
    expect(dialogManagerRenderSpy).not.toHaveBeenCalled();
  });
});
