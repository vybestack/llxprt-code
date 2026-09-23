/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Render behavior for capped tool results (issue #3428 section D): the capped
 * hint line, transcript-backed expansion when height constraints lift
 * (ctrl-s), and the capped preview returning after a scroll-forward purge.
 * Bodies come from the real SessionRecordingService on disk; assertions are
 * on rendered frames only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { act } from 'react';
import {
  createMockSettings,
  renderWithProviders,
  waitFor,
} from '../../../__tests__/render.js';
import { StreamingState, ToolCallStatus } from '../../types.js';
import { StreamingContext } from '../../contexts/StreamingContext.js';
import { ToolResultExpansionProvider } from '../../contexts/ToolResultExpansionContext.js';
import { createTerminalStore } from '../../stores/terminal/terminalStore.js';
import { TerminalProvider } from '../../stores/terminal/TerminalContext.js';
import { createTurnStore } from '../../stores/turn/turnStore.js';
import { TurnProvider } from '../../stores/turn/TurnContext.js';
import { boundResultDisplayForRetention } from '../../utils/toolResultRetention.js';
import { ToolMessage } from './ToolMessage.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KIB = 1024;

/**
 * Head and tail markers sit inside the capped preview windows; the sentinel
 * sits beyond the head window, so it exists only in the full body.
 */
const FULL_BODY = `HEADMARK\n${'a'.repeat(32 * KIB)}MIDDLESENTINEL${'b'.repeat(40 * KIB)}\nTAILMARK`;

function toolResponseContent(callId: string, result: unknown): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'test_tool',
        result,
        isComplete: true,
      },
    ],
  };
}

const baseProps = {
  callId: 'call-capped',
  name: 'test-tool',
  description: 'A tool for testing',
  confirmationDetails: undefined,
  status: ToolCallStatus.Success,
  terminalWidth: 200,
  emphasis: 'medium' as const,
  renderOutputAsMarkdown: false,
  availableTerminalHeight: 10,
};

function renderCappedToolMessage(cappedText: string, originalLength: number) {
  const settings = createMockSettings({
    ui: { alwaysDisplayFullShellCommand: true },
  });
  return renderWithProviders(
    <StreamingContext.Provider value={StreamingState.Idle}>
      <ToolMessage
        {...baseProps}
        resultDisplay={cappedText}
        retention={{ capped: true, originalLength }}
      />
    </StreamingContext.Provider>,
    { settings },
  );
}

describe('<ToolMessage /> capped-result expansion (issue #3428)', () => {
  let tempDir: string;
  let service: SessionRecordingService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '3428-render-'));
    service = new SessionRecordingService({
      sessionId: 'test-session-3428-render',
      projectHash: 'testhash',
      chatsDir: tempDir,
      workspaceDirs: [tempDir],
      provider: 'fake',
      model: 'fake-model',
    });
  });

  afterEach(async () => {
    await service.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('shows a one-line hint when a capped result renders without an expanded body', () => {
    const capped = boundResultDisplayForRetention(FULL_BODY);
    expect(capped.wasCapped).toBe(true);

    const { lastFrame } = renderCappedToolMessage(
      capped.text,
      capped.originalLength,
    );
    const frame = lastFrame() ?? '';

    // The capped preview itself renders (tail window is the visible part
    // under the height constraint).
    expect(frame).toContain('TAILMARK');
    // The hint: capped for display, ctrl-s loads the full output, and the
    // marker convention says where the full text lives.
    expect(frame).toContain('display capped at');
    expect(frame).toContain('ctrl-s');
    expect(frame).toContain('session transcript');
    // The beyond-the-window sentinel is NOT rendered while capped.
    expect(frame).not.toContain('MIDDLESENTINEL');
  });

  it('does not show the hint for uncapped results', () => {
    const settings = createMockSettings({
      ui: { alwaysDisplayFullShellCommand: true },
    });
    const { lastFrame } = renderWithProviders(
      <StreamingContext.Provider value={StreamingState.Idle}>
        <ToolMessage {...baseProps} resultDisplay="plain output" />
      </StreamingContext.Provider>,
      { settings },
    );
    expect(lastFrame() ?? '').not.toContain('display capped at');
  });

  /**
   * Renders the capped ToolMessage inside the full provider stack, with the
   * terminal unconstrained (ctrl-s lifted), the real turn store, and the
   * expansion provider wired to the real recorded transcript.
   */
  function renderExpandableCappedToolMessage(
    transcriptPath: string,
    turnStore: ReturnType<typeof createTurnStore>,
    cappedText: string,
    originalLength: number,
  ) {
    return renderWithProviders(
      <StreamingContext.Provider value={StreamingState.Idle}>
        <TerminalProvider
          store={createTerminalStore({ constrainHeight: false })}
        >
          <TurnProvider store={turnStore}>
            <ToolResultExpansionProvider
              getTranscriptFilePath={() => transcriptPath}
            >
              <ToolMessage
                {...baseProps}
                // When constraints lift, the parent passes no height bound
                // (DefaultAppLayoutHelpers: constrainHeight ? height : undefined).
                availableTerminalHeight={undefined}
                resultDisplay={cappedText}
                retention={{ capped: true, originalLength }}
              />
            </ToolResultExpansionProvider>
          </TurnProvider>
        </TerminalProvider>
      </StreamingContext.Provider>,
    );
  }

  it('loads the full body from the transcript when constraints lift (ctrl-s)', async () => {
    service.recordContent(toolResponseContent('call-capped', FULL_BODY));
    await service.flush();
    const transcriptPath = service.getFilePath() as string;
    const capped = boundResultDisplayForRetention(FULL_BODY);

    const turnStore = createTurnStore();
    const { lastFrame } = renderExpandableCappedToolMessage(
      transcriptPath,
      turnStore,
      capped.text,
      capped.originalLength,
    );

    await waitFor(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('MIDDLESENTINEL');
      expect(frame).toContain('TAILMARK');
    });
    // Full body in place of the capped preview: no truncation marker, no hint.
    expect(lastFrame() ?? '').not.toContain('middle omitted from display');
    expect(lastFrame() ?? '').not.toContain('display capped at');
  });

  it('returns to the capped preview after a scroll-forward append purges the expansion', async () => {
    service.recordContent(toolResponseContent('call-capped', FULL_BODY));
    await service.flush();
    const transcriptPath = service.getFilePath() as string;
    const capped = boundResultDisplayForRetention(FULL_BODY);

    const turnStore = createTurnStore();
    const { lastFrame } = renderExpandableCappedToolMessage(
      transcriptPath,
      turnStore,
      capped.text,
      capped.originalLength,
    );

    await waitFor(() => {
      expect(lastFrame() ?? '').toContain('MIDDLESENTINEL');
    });

    // Scroll-forward: a new ledger append purges; the capped preview (with its
    // marker and hint) renders again even though constraints stay lifted.
    act(() => {
      turnStore.commands.addItem(
        { type: 'user', text: 'next turn' },
        Date.now(),
      );
    });

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('MIDDLESENTINEL');
    expect(frame).toContain('middle omitted from display');
    expect(frame).toContain('display capped at');
  });
});
