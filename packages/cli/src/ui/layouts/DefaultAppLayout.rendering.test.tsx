/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';

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
import { act } from 'react';
import type { DOMElement } from 'ink';

const realInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realInkModule);

// Closed dialog-store stubs and omitted child components isolate layout geometry
// and history rendering. The Bun runner gives each test file its own process.
void vi.mock('../stores/dialog/DialogContext.js', () => ({
  useDialogStore: () => createDialogStore(),
  DialogProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
void vi.mock('../stores/dialog/dialogStore.js', () => ({
  createDialogStore: () => ({
    store: {
      getState: () => ({
        requests: [],
        confirmationRequest: null,
        confirmUpdateLlxprtExtensionRequests: [],
      }),
      subscribe: () => () => {},
      getInitialState: () => undefined,
    },
    commands: {
      openDialog: () => {},
      closeDialog: () => {},
      updateDialogPayload: () => {},
      setConfirmationRequest: () => {},
      addConfirmUpdateExtensionRequest: () => {},
      resolveConfirmUpdateExtensionRequest: () => {},
    },
  }),
}));
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
const { DefaultAppLayout } = await import('./DefaultAppLayout.js');
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { TerminalProvider } from '../stores/terminal/TerminalContext.js';
import { createTerminalStore } from '../stores/terminal/terminalStore.js';
import { TurnProvider } from '../stores/turn/TurnContext.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { registerJournalPagerFixture } from '../stores/turn/journal-turn-test-helpers.js';
const journalPager = registerJournalPagerFixture();
import { SettingsProfileProvider } from '../stores/settings/SettingsContext.js';
import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';
import { VimModeProvider } from '../contexts/VimModeContext.js';
const { buildSlashCommandRuntime, buildUiRuntimeFromSource } = await import(
  '../cliUiRuntime.js'
);

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

/** Renders DefaultAppLayout through real Ink and returns what tests assert on. */
async function renderLayout({
  useAlternateBuffer,
  screenReader = false,
  historyText,
}: RenderOptions): Promise<RenderedLayout> {
  const mainControlsRef: { current: DOMElement | null } = { current: null };
  const rootUiRef: { current: DOMElement | null } = { current: null };
  const pendingHistoryItemRef: { current: DOMElement | null } = {
    current: null,
  };
  const configSource = createConfigSource(screenReader);
  const settings = createSettings(useAlternateBuffer) as never;

  const turnStore = createTurnStore();
  const pager = await journalPager(
    historyText === undefined
      ? []
      : [{ speaker: 'human', blocks: [{ type: 'text', text: historyText }] }],
  );

  const rendered = render(
    <SettingsProfileProvider store={createSettingsProfileStore()}>
      <VimModeProvider settings={settings}>
        {/* Terminal-plane state lives in the TerminalStore; the 80x24
            seeding mirrors the geometry this suite asserts on. */}
        <TerminalProvider
          store={createTerminalStore({
            terminalWidth: 80,
            terminalHeight: TERMINAL_HEIGHT,
            mainAreaWidth: 80,
            inputWidth: 80,
            suggestionsWidth: 60,
            isNarrow: false,
            constrainHeight: false,
            availableTerminalHeight: TERMINAL_HEIGHT,
            isInputActive: true,
          })}
        >
          <TurnProvider store={turnStore}>
            <DefaultAppLayout
              scrollbackPager={{
                store: pager,
                viewport: {
                  visibleKeys: [],
                  viewportLines: 8,
                  rowHeightLines: () => 1,
                },
              }}
              uiRuntime={buildUiRuntimeFromSource(
                configSource as never,
                createUiSessionOwner(),
              )}
              slashCommandRuntime={buildSlashCommandRuntime(
                configSource as never,
                createUiSessionOwner(),
              )}
              settings={settings}
              startupWarnings={[]}
              version={'0.0.0-test'}
              nightly={false}
              mainControlsRef={mainControlsRef}
              rootUiRef={rootUiRef}
              pendingHistoryItemRef={pendingHistoryItemRef}
              contextFileNames={[]}
              updateInfo={null}
            />
          </TurnProvider>
        </TerminalProvider>
      </VimModeProvider>
    </SettingsProfileProvider>,
  );

  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const frame =
    useAlternateBuffer && !screenReader
      ? (rendered.lastFrame() ?? '')
      : rendered.frames.join(String.fromCharCode(10));

  const snapshot = {
    frame,
    lineCount: frame.split('\n').length,
    mainControlsRef: { current: mainControlsRef.current },
    rootUiRef: { current: rootUiRef.current },
  };
  await act(async () => {
    rendered.unmount();
  });
  return snapshot;
}

describe('DefaultAppLayout rendering', () => {
  afterEach(() => {
    restoreEnv();
  });

  describe('standard buffer with the static header suppressed', () => {
    it('mounts the live controls and the root when there are no static items', async () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { mainControlsRef, rootUiRef } = await renderLayout({
        useAlternateBuffer: false,
      });

      expect(rootUiRef.current).not.toBeNull();
      expect(mainControlsRef.current).not.toBeNull();
    });

    it('renders committed history content into the frame', async () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { frame } = await renderLayout({
        useAlternateBuffer: false,
        historyText: HISTORY_SENTINEL,
      });

      expect(frame).toContain(HISTORY_SENTINEL);
    });

    it('renders no history content when history is empty', async () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { frame, mainControlsRef } = await renderLayout({
        useAlternateBuffer: false,
      });

      expect(mainControlsRef.current).not.toBeNull();
      expect(frame).not.toContain(HISTORY_SENTINEL);
    });
  });

  describe('buffer selection', () => {
    it('renders a fixed-height viewport when the alternate buffer is enabled', async () => {
      const { lineCount, mainControlsRef } = await renderLayout({
        useAlternateBuffer: true,
      });

      expect(lineCount).toBe(TERMINAL_HEIGHT);
      expect(mainControlsRef.current).not.toBeNull();
    });

    it('renders a content-height root when the alternate buffer is disabled', async () => {
      setEnv('LLXPRT_CODE_SUPPRESS_STATIC_HEADER', 'true');

      const { frame, lineCount, mainControlsRef } = await renderLayout({
        useAlternateBuffer: false,
        historyText: HISTORY_SENTINEL,
      });

      // The sentinel guards against a degenerate render passing the
      // upper-bound line count: the frame has to carry real content.
      expect(frame).toContain(HISTORY_SENTINEL);
      expect(lineCount).toBeLessThan(TERMINAL_HEIGHT);
      expect(mainControlsRef.current).not.toBeNull();
    });

    it('falls back to the standard buffer when the screen reader is enabled', async () => {
      const { lineCount, mainControlsRef } = await renderLayout({
        useAlternateBuffer: true,
        screenReader: true,
      });

      expect(mainControlsRef.current).not.toBeNull();
      expect(lineCount).toBeLessThan(TERMINAL_HEIGHT);
    });
  });
});
