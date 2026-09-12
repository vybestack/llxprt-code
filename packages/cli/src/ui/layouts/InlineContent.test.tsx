/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { ApprovalMode, Config } from '@vybestack/llxprt-code-core';
import { render } from 'ink-testing-library';
import { LoadedSettings } from '../../config/settings.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { StreamingState } from '../types.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { AppCommandsProvider } from '../contexts/AppCommandsContext.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { createAppCommandBindings } from '../../test-utils/appCommandBindings.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { InlineContent, type InlineContentProps } from './InlineContent.js';

function ComposerHarness(props: InlineContentProps) {
  const terminal = useTerminalStore();
  const buffer = useTextBuffer({
    viewport: { width: 80, height: 24 },
    isValidPath: () => false,
  });
  const commands = createAppCommandBindings(
    'InlineContent',
    {
      buffer,
      commandContext: createMockCommandContext(),
      inputHistory: [],
    },
    { handleEscapePromptChange: terminal.commands.setShowEscapePrompt },
  );
  return (
    <AppCommandsProvider value={commands}>
      <StreamingContext.Provider value={props.streamingState}>
        <InlineContent {...props} />
      </StreamingContext.Provider>
    </AppCommandsProvider>
  );
}

const activeRenders: Array<ReturnType<typeof render>> = [];

// Override the global ink stub alias (vitest.config.ts) so InlineContent
// and its children use the real Ink components. Without this, the ink-stub
// passthrough fragments cause the real Ink reconciler to throw "Text string
// must be rendered inside <Text>", which renders as an error overlay locally
// but as a blank frame under CI (chalk level 0 suppresses the overlay) —
// making the tests non-deterministic across platforms.
//
// The factory imports the real Ink module via a direct file path (re-exported
// from test-utils/real-ink.ts) to bypass the `ink → ink-stub` resolve alias.
const { Text } = await import('ink');

const realRealInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realRealInkModule);

void vi.mock('../components/ContextSummaryDisplay.js', () => ({
  ContextSummaryDisplay: () => <Text color="white">context-summary-mock</Text>,
}));

function renderInlineContent(props: InlineContentProps) {
  const rendered = render(
    <StreamingContext.Provider value={props.streamingState}>
      <InlineContent {...props} />
    </StreamingContext.Provider>,
  );
  activeRenders.push(rendered);
  return rendered;
}

function createProps(): InlineContentProps {
  return {
    streamingState: StreamingState.Idle,
    disableLoadingPhrases: false,
    thought: null,
    currentLoadingPhrase: undefined,
    elapsedTime: 0,
    hideContextSummary: true,
    isNarrow: false,
    ctrlCPressedOnce: false,
    ctrlDPressedOnce: false,
    showEscapePrompt: false,
    ideContextState: undefined,
    llxprtMdFileCount: 0,
    coreMemoryFileCount: 0,
    contextFileNames: [],
    config: buildSlashCommandRuntime(
      new Config({
        sessionId: 'inline-content-test',
        targetDir: tmpdir(),
        cwd: tmpdir(),
        debugMode: false,
        model: 'test-model',
      }),
    ),
    showToolDescriptions: false,
    showAutoAcceptIndicator: ApprovalMode.DEFAULT,
    shellModeActive: false,
    showErrorDetails: false,
    consoleMessages: [],
    constrainHeight: false,
    debugConsoleMaxHeight: 0,
    inputWidth: 80,
    isInputActive: false,
    settings: new LoadedSettings(
      { path: '/system/settings.json', settings: {} },
      { path: '/system/defaults.json', settings: {} },
      { path: '/user/settings.json', settings: {} },
      { path: '/workspace/settings.json', settings: {} },
      true,
    ),
    onSuggestionsVisibilityChange: vi.fn(),
  };
}

function createVimSettings(): LoadedSettings {
  return new LoadedSettings(
    { path: '/system/settings.json', settings: {} },
    { path: '/system/defaults.json', settings: {} },
    { path: '/user/settings.json', settings: { ui: { vimMode: true } } },
    { path: '/workspace/settings.json', settings: {} },
    true,
  );
}

/** Composer mode variants: shell mode is a terminal store flag, vim mode a
 * user setting read through VimModeProvider. */
const COMPOSER_MODES = [
  {
    mode: 'default',
    composerOptions: {},
    placeholder: 'Type your message or @path/to/file',
  },
  {
    mode: 'vim',
    composerOptions: { vimEnabled: true },
    placeholder: "Press 'i' for INSERT mode",
  },
  {
    mode: 'shell',
    composerOptions: { shellModeActive: true },
    placeholder: 'Type your shell command',
  },
] satisfies Array<{
  mode: string;
  composerOptions: { vimEnabled?: boolean; shellModeActive?: boolean };
  placeholder: string;
}>;

interface ComposerOptions {
  vimEnabled?: boolean;
  shellModeActive?: boolean;
}

function renderComposer(
  options: ComposerOptions = {},
  isInputActive = true,
): ReturnType<typeof render> {
  const settings =
    options.vimEnabled === true ? createVimSettings() : createProps().settings;
  const props = {
    ...createProps(),
    isInputActive,
    settings,
  };
  const rendered = renderWithProviders(<ComposerHarness {...props} />, {
    settings: props.settings,
    terminal: { shellModeActive: options.shellModeActive ?? false },
  });
  activeRenders.push(rendered);
  return rendered;
}

describe('InlineContent', () => {
  beforeEach(() => {
    setEnv('GEMINI_SYSTEM_MD', '');
  });

  afterEach(() => {
    for (const rendered of activeRenders.splice(0)) {
      rendered.unmount();
    }
    restoreEnv();
  });

  it('does not render transient status text when no left status is visible', () => {
    const { lastFrame } = renderInlineContent(createProps());

    expect(lastFrame()).not.toMatch(/Press|⌐■_■/);
  });

  it('does not add narrow-screen spacing when no status indicator is visible', () => {
    const { lastFrame: regularFrame } = renderInlineContent(createProps());
    const { lastFrame: narrowFrame } = renderInlineContent({
      ...createProps(),
      isNarrow: true,
    });

    expect(narrowFrame()).toBe(regularFrame());
  });

  it('renders the escape prompt', () => {
    const props = { ...createProps(), showEscapePrompt: true };
    const { lastFrame } = renderInlineContent(props);

    expect(lastFrame()).toContain('Press Esc again to clear.');
  });

  it('renders the Ctrl+C exit prompt', () => {
    const props = { ...createProps(), ctrlCPressedOnce: true };
    const { lastFrame } = renderInlineContent(props);

    expect(lastFrame()).toContain('Press Ctrl+C again to exit.');
  });

  it('renders the Ctrl+D exit prompt', () => {
    const props = { ...createProps(), ctrlDPressedOnce: true };
    const { lastFrame } = renderInlineContent(props);

    expect(lastFrame()).toContain('Press Ctrl+D again to exit.');
  });

  it('renders when the context summary is visible', () => {
    const props = { ...createProps(), hideContextSummary: false };
    const { lastFrame } = renderInlineContent(props);

    expect(lastFrame()).toContain('context-summary-mock');
  });

  it.each(COMPOSER_MODES)(
    'renders the $mode placeholder through the composer input surface when input is active',
    ({ composerOptions, placeholder }) => {
      const { lastFrame } = renderComposer(composerOptions);

      expect(lastFrame()).toContain(placeholder);
    },
  );

  it.each(COMPOSER_MODES)(
    'does not render the $mode placeholder when input is inactive',
    ({ composerOptions, placeholder }) => {
      const { lastFrame } = renderComposer(composerOptions, false);

      expect(lastFrame()).not.toContain(placeholder);
    },
  );

  it('renders the system-md indicator when GEMINI_SYSTEM_MD is set', () => {
    setEnv('GEMINI_SYSTEM_MD', 'true');
    const { lastFrame } = renderInlineContent(createProps());

    expect(lastFrame()).toContain('⌐■_■');
  });
});
