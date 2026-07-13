/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalMode, Config } from '@vybestack/llxprt-code-core';
import { render } from 'ink-testing-library';
import { LoadedSettings } from '../../config/settings.js';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { StreamingState } from '../types.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { InlineContent, type InlineContentProps } from './InlineContent.js';

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

vi.mock('../components/ContextSummaryDisplay.js', () => ({
  ContextSummaryDisplay: () => null,
}));

function renderInlineContent(props: InlineContentProps) {
  return render(
    <StreamingContext.Provider value={props.streamingState}>
      <InlineContent {...props} />
    </StreamingContext.Provider>,
  );
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
        targetDir: '/tmp',
        cwd: '/tmp',
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
    vi.stubEnv('GEMINI_SYSTEM_MD', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not render transient status text when no left status is visible', () => {
    const { lastFrame } = renderInlineContent(createProps());

    expect(lastFrame()).not.toMatch(/Press|⌐■_■/);
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

    expect(lastFrame()).toBeDefined();
  });

  it('renders the system-md indicator when GEMINI_SYSTEM_MD is set', () => {
    vi.stubEnv('GEMINI_SYSTEM_MD', '1');
    const { lastFrame } = renderInlineContent(createProps());

    expect(lastFrame()).toContain('⌐■_■');
  });
});
