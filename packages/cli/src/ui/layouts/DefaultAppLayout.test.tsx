/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { Text } from '../../../test-utils/real-ink.js';

// Unmock ink to use real Ink with ink-testing-library
// The global mock in test-setup.ts conflicts with renderer behavior here.
// Under Bun, ink is redirected to a stub by a resolution plugin rather than a
// module mock, so there is nothing to unmock.
const realInkModule = await import('../../../test-utils/real-ink.js');

void vi.mock('ink', () => realInkModule);

import { DefaultAppLayout } from './DefaultAppLayout.js';
import { hasActiveDialog } from './DefaultAppLayoutHelpers.js';
import { useUIState, type UIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { StreamingState } from '../types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from '../cliUiRuntime.js';

const DIALOG_MANAGER_SENTINEL = 'DIALOG_MANAGER_RENDERED';
const COMPOSER_SENTINEL = 'COMPOSER_RENDERED';

const DialogManagerSentinel = () => (
  <Text color="white">{DIALOG_MANAGER_SENTINEL}</Text>
);
const ComposerSentinel = () => <Text color="white">{COMPOSER_SENTINEL}</Text>;

void vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: vi.fn(),
}));

void vi.mock('../contexts/UIActionsContext.js', () => ({
  useUIActions: vi.fn(),
}));

void vi.mock('../components/DialogManager.js', () => ({
  DialogManager: DialogManagerSentinel,
}));

void vi.mock('../components/Composer.js', () => ({
  Composer: ComposerSentinel,
}));

// Mock all other child components as null so this test only verifies
// dialog gating behavior in DefaultAppLayout.
void vi.mock('../components/AppHeader.js', () => ({ AppHeader: () => null }));
void vi.mock('../components/HistoryItemDisplay.js', () => ({
  HistoryItemDisplay: () => null,
}));
void vi.mock('../components/ShowMoreLines.js', () => ({
  ShowMoreLines: () => null,
}));
void vi.mock('../components/Notifications.js', () => ({
  Notifications: () => null,
}));
void vi.mock('../components/TodoPanel.js', () => ({ TodoPanel: () => null }));
void vi.mock('../components/Footer.js', () => ({ Footer: () => null }));
void vi.mock('../components/BucketAuthConfirmation.js', () => ({
  BucketAuthConfirmation: () => null,
}));
void vi.mock('../components/LoadingIndicator.js', () => ({
  LoadingIndicator: () => null,
}));
void vi.mock('../components/AutoAcceptIndicator.js', () => ({
  AutoAcceptIndicator: () => null,
}));
void vi.mock('../components/ShellModeIndicator.js', () => ({
  ShellModeIndicator: () => null,
}));
void vi.mock('../components/ContextSummaryDisplay.js', () => ({
  ContextSummaryDisplay: () => null,
}));
void vi.mock('../components/DetailedMessagesDisplay.js', () => ({
  DetailedMessagesDisplay: () => null,
}));
void vi.mock('../components/shared/ScrollableList.js', () => ({
  ScrollableList: () => null,
}));
void vi.mock('../components/shared/VirtualizedList.js', () => ({
  SCROLL_TO_ITEM_END: -1,
}));

void vi.mock('../themes/theme-manager.js', () => ({
  themeManager: {
    getActiveTheme: () => ({
      name: 'default',
      colors: {
        GradientColors: ['#ffffff', '#ffffff'],
      },
    }),
  },
}));

void vi.mock('../colors.js', () => ({
  Colors: {
    AccentRed: '#ff0000',
    AccentYellow: '#ffff00',
    Gray: '#808080',
    GradientColors: ['#ffffff'],
  },
  SemanticColors: new Proxy({}, { get: () => '#808080' }),
}));

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  ephemeralSettingHelp: {},
  parseEphemeralSettingValue: vi.fn((_key: string, rawValue: string) => ({
    success: true,
    value: rawValue,
  })),
  applyCliSetArguments: vi.fn(() => ({ modelParams: {} })),
  getCliRuntimeContext: () => ({
    messageBus: {
      subscribe: vi.fn(),
      publish: vi.fn(),
      unsubscribe: vi.fn(),
      requestBucketAuthConfirmation: vi.fn(),
    },
  }),
}));

const mockUseUIState = useUIState as Mock<typeof useUIState>;
const mockUseUIActions = useUIActions as Mock<typeof useUIActions>;

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
    isNarrow: false,
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
    isQueuedMessagesPanelCollapsed: false,
    queuedSubmissions: [],
    coreMemoryFileCount: 0,
    currentModelLabel: undefined,
    contextLimit: undefined,

    // dialog flags
    showWorkspaceMigrationDialog: false,
    shouldShowIdePrompt: false,
    isFolderTrustDialogOpen: false,
    isWelcomeDialogOpen: false,
    isPermissionsDialogOpen: false,
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
    isModelConfigDialogOpen: false,
    isPoliciesDialogOpen: false,
    showPrivacyNotice: false,

    rootUiRef: { current: null },
    pendingHistoryItemRef: { current: null },
  } as never;
}

const ACTIVE_DIALOG_FLAGS = [
  'showWorkspaceMigrationDialog',
  'shouldShowIdePrompt',
  'isFolderTrustDialogOpen',
  'isWelcomeDialogOpen',
  'isPermissionsDialogOpen',
  'confirmationRequest',
  'isThemeDialogOpen',
  'isSettingsDialogOpen',
  'isAuthDialogOpen',
  'isOAuthCodeDialogOpen',
  'isEditorDialogOpen',
  'isProviderDialogOpen',
  'isLoadProfileDialogOpen',
  'isCreateProfileDialogOpen',
  'isProfileListDialogOpen',
  'isProfileDetailDialogOpen',
  'isProfileEditorDialogOpen',
  'isToolsDialogOpen',
  'isLoggingDialogOpen',
  'isSubagentDialogOpen',
  'isModelsDialogOpen',
  'isSessionBrowserDialogOpen',
  'isModelConfigDialogOpen',
  'isPoliciesDialogOpen',
  'showPrivacyNotice',
] as const satisfies ReadonlyArray<keyof UIState>;

type ActiveDialogFlag = (typeof ACTIVE_DIALOG_FLAGS)[number];

function createUIStateWithActiveDialog(flag: ActiveDialogFlag): UIState {
  const baseState: UIState = createBaseUIState();
  if (flag === 'confirmationRequest') {
    return {
      ...baseState,
      confirmationRequest: {
        prompt: null,
        onConfirm: () => {},
      },
    };
  }
  return { ...baseState, [flag]: true };
}

function renderDefaultAppLayout(uiState: UIState): ReturnType<typeof render> {
  mockUseUIState.mockReturnValue(uiState);
  const config = createConfigStub() as never;

  return render(
    <DefaultAppLayout
      uiRuntime={buildUiRuntimeFromSource(config)}
      slashCommandRuntime={buildSlashCommandRuntime(config)}
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
}

describe('DefaultAppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUIActions.mockReturnValue(createActionsStub() as never);
  });

  it('keeps the dialog test table aligned with every property read by the real predicate', () => {
    const readKeys = new Set<string>();
    const recordKey = (property: string | symbol): void => {
      if (typeof property !== 'string') {
        throw new Error(
          `hasActiveDialog read the symbol key ${String(property)}. The drift ` +
            'guard can only account for string keys; update the guard and ' +
            'ACTIVE_DIALOG_FLAGS together.',
        );
      }
      readKeys.add(property);
    };
    // Enumeration would let the predicate reach every flag at once, which
    // would make the recorded read-set meaningless. Fail loudly instead of
    // silently passing.
    const rejectEnumeration = (trap: string): never => {
      throw new Error(
        `hasActiveDialog enumerated the UI state via ${trap}. The drift guard ` +
          'observes discrete property accesses and cannot verify an ' +
          'enumeration-based predicate; update the guard and ' +
          'ACTIVE_DIALOG_FLAGS together.',
      );
    };
    const uiState = new Proxy(createBaseUIState(), {
      get(target, property, receiver) {
        recordKey(property);
        return Reflect.get(target, property, receiver);
      },
      has(target, property) {
        recordKey(property);
        return Reflect.has(target, property);
      },
      ownKeys: () => rejectEnumeration('ownKeys'),
      getOwnPropertyDescriptor: () =>
        rejectEnumeration('getOwnPropertyDescriptor'),
    });

    hasActiveDialog(uiState);

    expect([...readKeys].sort()).toEqual([...ACTIVE_DIALOG_FLAGS].sort());
  });

  it.each(ACTIVE_DIALOG_FLAGS.map((flag) => [flag] as const))(
    'renders DialogManager instead of Composer when %s is active',
    (flag) => {
      const rendered = renderDefaultAppLayout(
        createUIStateWithActiveDialog(flag),
      );
      const frame = rendered.lastFrame();

      expect(frame).toContain(DIALOG_MANAGER_SENTINEL);
      expect(frame).not.toContain(COMPOSER_SENTINEL);
      rendered.unmount();
    },
  );

  it('renders Composer when no dialog is open', () => {
    const rendered = renderDefaultAppLayout(createBaseUIState());
    const frame = rendered.lastFrame();

    expect(frame).toContain(COMPOSER_SENTINEL);
    expect(frame).not.toContain(DIALOG_MANAGER_SENTINEL);
    rendered.unmount();
  });
});
