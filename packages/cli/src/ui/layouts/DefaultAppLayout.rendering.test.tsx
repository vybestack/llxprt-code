/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rendering regression coverage for DefaultAppLayout (issue #2025).
 *
 * These tests render through REAL Ink (the package test setup otherwise
 * redirects `ink` to a stub) so the assertions are made against actual frame
 * output and real Ink refs rather than render spies.
 *
 * The alternate-buffer branch mounts a fixed-height viewport
 * (`height={terminalHeight}`, `overflow="hidden"`), so its frame is padded to
 * exactly `terminalHeight` lines. The standard-buffer branch mounts a
 * content-height root (`width="90%"`, no height), so its frame is shorter.
 * Frame line count is therefore a mock-free discriminator between the two
 * branches.
 *
 * Note: an empty `<Static>` renders byte-identically to `null` under Ink, so
 * the absence of the static region cannot be observed from frame output. What
 * is observable — and what is asserted here — is that static content reaches
 * the frame exactly when there is static content to show.
 */

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { render } from 'ink-testing-library';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { DOMElement } from 'ink';

const realInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realInkModule);

// Leaf components unrelated to layout branching. None of their output is
// asserted on; they are stubbed only to keep the tree renderable.
void vi.mock('../components/DialogManager.js', () => ({
  DialogManager: () => null,
}));
void vi.mock('../components/Composer.js', () => ({ Composer: () => null }));
void vi.mock('../components/AppHeader.js', () => ({ AppHeader: () => null }));
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

// The CLI runtime context is process-global infrastructure that the layout
// only reads to hand a message bus to the (stubbed) bucket-auth confirmation.
const providersRuntime = await import(
  '@vybestack/llxprt-code-providers/runtime.js'
);

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  ...providersRuntime,
  getCliRuntimeContext: () => ({
    messageBus: {
      subscribe: vi.fn(),
      publish: vi.fn(),
      unsubscribe: vi.fn(),
      requestBucketAuthConfirmation: vi.fn(),
    },
  }),
}));

const { DefaultAppLayout } = await import('./DefaultAppLayout.js');
const { UIStateContext } = await import('../contexts/UIStateContext.js');
const { UIActionsContext } = await import('../contexts/UIActionsContext.js');
const { StreamingState } = await import('../types.js');
const { buildSlashCommandRuntime, buildUiRuntimeFromSource } = await import(
  '../cliUiRuntime.js'
);

const TERMINAL_WIDTH = 80;
const TERMINAL_HEIGHT = 24;

/** Sentinel supplied as history-item input; never produced by a stub. */
const HISTORY_SENTINEL = 'static-history-sentinel-2026';

/** Inputs that select the layout branch under test. */
interface RenderOptions {
  useAlternateBuffer: boolean;
  screenReader?: boolean;
  historyText?: string;
}

/** What a render exposes to assertions: frame text, geometry, and real Ink refs. */
interface RenderedLayout {
  frame: string;
  lineCount: number;
  mainControlsRef: { current: DOMElement | null };
  rootUiRef: { current: DOMElement | null };
}

/**
 * Minimal runtime source. Only `getScreenReader` varies, because it is the
 * gate `useLayoutSettings` applies on top of `ui.useAlternateBuffer`.
 */
function createConfigSource(screenReader: boolean) {
  return {
    getScreenReader: () => screenReader,
    getAccessibility: () => ({ disableLoadingPhrases: false }),
    getMcpServers: () => [],
    getBlockedMcpServers: () => [],
    getTargetDir: () => '/tmp',
    getDebugMode: () => false,
    getEphemeralSetting: () => undefined,
    isTrustedFolder: () => true,
  };
}

/** Settings carrying the buffer choice the layout branches on. */
function createSettings(useAlternateBuffer: boolean) {
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

/** UI actions the layout hands to its children; none are asserted on. */
function createActions() {
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

/**
 * UI state for a render. `rootUiRef` is threaded in so the caller can observe
 * whether the layout actually mounted its root.
 */
function createUIState(
  rootUiRef: { current: DOMElement | null },
  historyText: string | undefined,
) {
  return {
    terminalWidth: TERMINAL_WIDTH,
    terminalHeight: TERMINAL_HEIGHT,
    mainAreaWidth: TERMINAL_WIDTH,
    inputWidth: TERMINAL_WIDTH,
    suggestionsWidth: 60,
    isNarrow: false,
    history:
      historyText === undefined
        ? []
        : [{ id: 1, type: 'user', text: historyText }],
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
    availableTerminalHeight: TERMINAL_HEIGHT,
    activeShellPtyId: null,
    embeddedShellFocused: false,
    isQueuedMessagesPanelCollapsed: false,
    queuedSubmissions: [],
    coreMemoryFileCount: 0,
    currentModelLabel: undefined,
    contextLimit: undefined,

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

    rootUiRef,
    pendingHistoryItemRef: { current: null },
  };
}

/** Renders DefaultAppLayout through real Ink and returns what tests assert on. */
function renderLayout({
  useAlternateBuffer,
  screenReader = false,
  historyText,
}: RenderOptions): RenderedLayout {
  const mainControlsRef: { current: DOMElement | null } = { current: null };
  const rootUiRef: { current: DOMElement | null } = { current: null };
  const configSource = createConfigSource(screenReader);

  const rendered = render(
    <UIStateContext.Provider
      value={createUIState(rootUiRef, historyText) as never}
    >
      <UIActionsContext.Provider value={createActions() as never}>
        <DefaultAppLayout
          uiRuntime={buildUiRuntimeFromSource(configSource as never)}
          slashCommandRuntime={buildSlashCommandRuntime(configSource as never)}
          settings={createSettings(useAlternateBuffer) as never}
          startupWarnings={[]}
          version={'0.0.0-test'}
          nightly={false}
          mainControlsRef={mainControlsRef}
          availableTerminalHeight={TERMINAL_HEIGHT}
          contextFileNames={[]}
          updateInfo={null}
        />
      </UIActionsContext.Provider>
    </UIStateContext.Provider>,
  );

  const frame = rendered.lastFrame() ?? '';

  return {
    frame,
    lineCount: frame.split('\n').length,
    mainControlsRef,
    rootUiRef,
  };
}

describe('DefaultAppLayout rendering', () => {
  afterEach(() => {
    restoreEnv();
  });

  describe('standard buffer with the static header suppressed', () => {
    it('mounts the live controls and the root when there are no static items', () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { mainControlsRef, rootUiRef } = renderLayout({
        useAlternateBuffer: false,
      });

      expect(rootUiRef.current).not.toBeNull();
      expect(mainControlsRef.current).not.toBeNull();
    });

    it('renders committed history content into the frame', () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { frame } = renderLayout({
        useAlternateBuffer: false,
        historyText: HISTORY_SENTINEL,
      });

      expect(frame).toContain(HISTORY_SENTINEL);
    });

    it('renders no history content when history is empty', () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { frame, mainControlsRef } = renderLayout({
        useAlternateBuffer: false,
      });

      expect(mainControlsRef.current).not.toBeNull();
      expect(frame).not.toContain(HISTORY_SENTINEL);
    });
  });

  describe('buffer selection', () => {
    it('renders a fixed-height viewport when the alternate buffer is enabled', () => {
      const { lineCount, mainControlsRef } = renderLayout({
        useAlternateBuffer: true,
      });

      expect(lineCount).toBe(TERMINAL_HEIGHT);
      expect(mainControlsRef.current).not.toBeNull();
    });

    it('renders a content-height root when the alternate buffer is disabled', () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { frame, lineCount, mainControlsRef } = renderLayout({
        useAlternateBuffer: false,
        historyText: HISTORY_SENTINEL,
      });

      // The sentinel guards against a degenerate render passing the
      // upper-bound line count: the frame has to carry real content.
      expect(frame).toContain(HISTORY_SENTINEL);
      expect(lineCount).toBeLessThan(TERMINAL_HEIGHT);
      expect(mainControlsRef.current).not.toBeNull();
    });

    it('falls back to the standard buffer when the screen reader is enabled', () => {
      const { lineCount, mainControlsRef } = renderLayout({
        useAlternateBuffer: true,
        screenReader: true,
      });

      expect(mainControlsRef.current).not.toBeNull();
      expect(lineCount).toBeLessThan(TERMINAL_HEIGHT);
    });
  });
});
