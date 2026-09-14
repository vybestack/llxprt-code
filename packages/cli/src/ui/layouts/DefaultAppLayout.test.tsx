/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'bun:test';
import { Text } from '../../../test-utils/real-ink.js';

// Unmock ink to use real Ink with ink-testing-library
// The global mock in test-setup.ts conflicts with renderer behavior here.
// Under Bun, ink is redirected to a stub by a resolution plugin rather than a
// module mock, so there is nothing to unmock.
const realInkModule = await import('../../../test-utils/real-ink.js');

void vi.mock('ink', () => realInkModule);

import { DefaultAppLayout } from './DefaultAppLayout.js';
import { DialogProvider } from '../stores/dialog/DialogContext.js';
import { TerminalProvider } from '../stores/terminal/TerminalContext.js';
import { createTerminalStore } from '../stores/terminal/terminalStore.js';
import { TurnProvider } from '../stores/turn/TurnContext.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { SettingsProfileProvider } from '../stores/settings/SettingsContext.js';
import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';
import { VimModeProvider } from '../contexts/VimModeContext.js';
import {
  createDialogStore,
  DIALOG_PRIORITY,
  type DialogKind,
  type DialogStore,
} from '../stores/dialog/dialogStore.js';
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

interface RenderLayoutOptions {
  settings?: ReturnType<typeof createSettingsStub>;
  store?: DialogStore;
}

function renderDefaultAppLayout({
  settings = createSettingsStub(),
  store = createDialogStore(),
}: RenderLayoutOptions = {}): ReturnType<typeof render> {
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
      rootUiRef={{ current: null }}
      pendingHistoryItemRef={{ current: null }}
      contextFileNames={[]}
      updateInfo={null}
    />
  );
  // TerminalStore seeding mirrors the dimensions the old UIState fixture
  // carried (120x40), so layout gating behavior is unchanged. The turn and
  // settings stores keep their defaults; this suite asserts dialog gating
  // and buffer selection only.
  const terminalStore = createTerminalStore({
    terminalWidth: 120,
    terminalHeight: 40,
    mainAreaWidth: 120,
    inputWidth: 120,
    suggestionsWidth: 60,
    isNarrow: false,
    constrainHeight: false,
    availableTerminalHeight: 40,
    isInputActive: true,
  });
  return render(
    <SettingsProfileProvider store={createSettingsProfileStore()}>
      <VimModeProvider settings={settings as never}>
        <TerminalProvider store={terminalStore}>
          <TurnProvider store={createTurnStore()}>
            <DialogProvider store={store}>{inner}</DialogProvider>
          </TurnProvider>
        </TerminalProvider>
      </VimModeProvider>
    </SettingsProfileProvider>,
  );
}

describe('DefaultAppLayout', () => {
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

      const rendered = renderDefaultAppLayout({ store });
      const frame = rendered.lastFrame();

      expect(frame).toContain(DIALOG_MANAGER_SENTINEL);
      expect(frame).not.toContain(COMPOSER_SENTINEL);
      rendered.unmount();
    },
  );

  it('renders Composer when no dialog is open', () => {
    const rendered = renderDefaultAppLayout();
    const frame = rendered.lastFrame();

    expect(frame).toContain(COMPOSER_SENTINEL);
    expect(frame).not.toContain(DIALOG_MANAGER_SENTINEL);
    rendered.unmount();
  });

  it('renders standard and alternate buffer layout branches according to settings', () => {
    const alternateBuffer = renderDefaultAppLayout();
    const alternateBufferFrame = alternateBuffer.lastFrame();
    alternateBuffer.unmount();

    const standardBuffer = renderDefaultAppLayout({
      settings: createSettingsStub({ useAlternateBuffer: false }),
    });
    const standardBufferFrame = standardBuffer.lastFrame();
    standardBuffer.unmount();

    expect(alternateBufferFrame).toContain(ALTERNATE_BUFFER_SENTINEL);
    expect(alternateBufferFrame).not.toContain(STANDARD_BUFFER_SENTINEL);
    expect(standardBufferFrame).toContain(STANDARD_BUFFER_SENTINEL);
    expect(standardBufferFrame).not.toContain(ALTERNATE_BUFFER_SENTINEL);
  });
});
