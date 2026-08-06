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
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { StreamingState } from '../types.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { InlineContent, type InlineContentProps } from './InlineContent.js';

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
vi.mock('ink', async () => import('../../../test-utils/real-ink.js'));

vi.mock('../components/ContextSummaryDisplay.js', async () => {
  const { Text } = await import('ink');
  return {
    ContextSummaryDisplay: () => (
      <Text color="white">context-summary-mock</Text>
    ),
  };
});

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

  it('renders the system-md indicator when GEMINI_SYSTEM_MD is set', () => {
    setEnv('GEMINI_SYSTEM_MD', 'true');
    const { lastFrame } = renderInlineContent(createProps());

    expect(lastFrame()).toContain('⌐■_■');
  });
});
