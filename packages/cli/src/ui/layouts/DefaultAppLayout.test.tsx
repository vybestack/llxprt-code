/**
 * @license
 * Copyright 2026 Vybestack LLC
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
import { DialogProvider } from '../stores/dialog/DialogContext.js';
import {
  createDialogStore,
  DIALOG_PRIORITY,
  type DialogKind,
  type DialogStore,
} from '../stores/dialog/dialogStore.js';
import { useUIState, type UIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { StreamingState } from '../types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from '../cliUiRuntime.js';

const DIALOG_MANAGER_SENTINEL = 'DIALOG_MANAGER_RENDERED';
const STANDARD_BUFFER_SENTINEL = 'STANDARD_BUFFER_HISTORY';
const ALTERNATE_BUFFER_SENTINEL = 'ALTERNATE_BUFFER_HISTORY';
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
  ShowMoreLines: () => <Text color="white">{STANDARD_BUFFER_SENTINEL}</Text>,
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
  ScrollableList: () => <Text color="white">{ALTERNATE_BUFFER_SENTINEL}</Text>,
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

function createSettingsStub({
  useAlternateBuffer = true,
}: { readonly useAlternateBuffer?: boolean } = {}) {
  return {
    merged: {
      ui: {
        showTodoPanel: false,
        hideFooter: false,
        hideContextSummary: false,
        useAlternateBuffer,
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

    // Store-driven dialog kinds assert against the store itself; the
    // createUIStateWithActiveDialog fixture and dialog booleans are gone.

    rootUiRef: { current: null },
    pendingHistoryItemRef: { current: null },
  } as never;
}

/**
 * Every dialog kind whose open state lives in the DialogStore. The drift
 * guard below fails when a kind is added to DIALOG_PRIORITY without this
 * table (or vice versa), so gating coverage cannot silently regress.
 */
const STORE_DRIVEN_DIALOG_KINDS = [
  'workspaceMigration',
  'idePrompt',
  'folderTrust',
  'welcome',
  'confirmation',
  'extensionUpdateConfirm',
  'theme',
  'settings',
  'auth',
  'oauthCode',
  'editor',
  'provider',
  'loadProfile',
  'createProfile',
  'profileList',
  'profileDetail',
  'profileEditor',
  'tools',
  'privacy',
  'permissions',
  'logging',
  'subagent',
  'models',
  'sessionBrowser',
  'modelConfig',
  'policies',
] as const satisfies readonly DialogKind[];

function openStoreDialog(store: DialogStore, kind: DialogKind): void {
  switch (kind) {
    case 'workspaceMigration':
      store.commands.openDialog({ kind, payload: { extensions: [] } });
      break;
    case 'idePrompt':
      store.commands.openDialog({
        kind,
        payload: { ide: { name: 'vscode', displayName: 'VS Code' } },
      });
      break;
    case 'confirmation':
    case 'extensionUpdateConfirm':
      store.commands.openDialog({
        kind,
        payload: { prompt: null, onConfirm: () => {} },
      });
      break;
    case 'profileDetail':
    case 'profileEditor':
      store.commands.openDialog({ kind, payload: { profileName: 'p' } });
      break;
    case 'tools':
      store.commands.openDialog({ kind, payload: { action: 'enable' } });
      break;
    case 'logging':
      store.commands.openDialog({ kind, payload: { entries: [] } });
      break;
    default:
      store.commands.openDialog({ kind, payload: {} });
  }
}

function renderDefaultAppLayout(
  uiState: UIState,
  settings = createSettingsStub(),
  store = createDialogStore(),
): ReturnType<typeof render> {
  mockUseUIState.mockReturnValue(uiState);
  const config = createConfigStub() as never;

  const inner = (
    <DefaultAppLayout
      uiRuntime={buildUiRuntimeFromSource(config)}
      slashCommandRuntime={buildSlashCommandRuntime(config)}
      settings={settings as never}
      startupWarnings={[]}
      version={'0.0.0-test'}
      nightly={false}
      mainControlsRef={{ current: null }}
      availableTerminalHeight={40}
      contextFileNames={[]}
      updateInfo={null}
    />
  );
  return render(<DialogProvider store={store}>{inner}</DialogProvider>);
}

describe('DefaultAppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUIActions.mockReturnValue(createActionsStub() as never);
  });

  it('keeps the store-driven dialog table aligned with DIALOG_PRIORITY', () => {
    // useHasActiveDialog reads only the DialogStore; the drift risk is a new
    // store kind missing from this table, so guard against DIALOG_PRIORITY.
    expect([...STORE_DRIVEN_DIALOG_KINDS]).toStrictEqual([...DIALOG_PRIORITY]);
  });

  it.each(STORE_DRIVEN_DIALOG_KINDS.map((kind) => [kind] as const))(
    'renders DialogManager instead of Composer when the %s dialog is open in the DialogStore',
    (kind) => {
      const store = createDialogStore();
      openStoreDialog(store, kind);

      const rendered = renderDefaultAppLayout(
        createBaseUIState(),
        undefined,
        store,
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

  it('renders standard and alternate buffer layout branches according to settings', () => {
    const alternateBuffer = renderDefaultAppLayout(createBaseUIState());
    const alternateBufferFrame = alternateBuffer.lastFrame();
    alternateBuffer.unmount();

    const standardBuffer = renderDefaultAppLayout(
      createBaseUIState(),
      createSettingsStub({ useAlternateBuffer: false }),
    );
    const standardBufferFrame = standardBuffer.lastFrame();
    standardBuffer.unmount();

    expect(alternateBufferFrame).toContain(ALTERNATE_BUFFER_SENTINEL);
    expect(alternateBufferFrame).not.toContain(STANDARD_BUFFER_SENTINEL);
    expect(standardBufferFrame).toContain(STANDARD_BUFFER_SENTINEL);
    expect(standardBufferFrame).not.toContain(ALTERNATE_BUFFER_SENTINEL);
  });
});
