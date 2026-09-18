/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-level behavior for transcript-backed expansion (issue #3428
 * section D): lifting height constraints loads the exact original body from a
 * real recorded session, and appending to the history ledger purges it so the
 * capped preview renders again (#854 point 1). Assertions are on rendered
 * output only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Text } from 'ink';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { act } from 'react';
import { render, waitFor } from '../../test-utils/render.js';
import { Colors } from '../colors.js';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { createTerminalStore } from '../stores/terminal/terminalStore.js';
import { TerminalProvider } from '../stores/terminal/TerminalContext.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { TurnProvider } from '../stores/turn/TurnContext.js';
import { boundResultDisplayForRetention } from '../utils/toolResultRetention.js';
import {
  ToolResultExpansionProvider,
  useExpandedToolResultBody,
  useLoadExpandedToolResult,
} from './ToolResultExpansionContext.js';

const KIB = 1024;

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

function Probe({
  callId,
  cappedPreview,
}: {
  callId: string;
  cappedPreview: string;
}) {
  const body = useExpandedToolResultBody(callId);
  useLoadExpandedToolResult(callId, true);
  if (body === undefined) {
    return (
      <Text
        color={Colors.Foreground}
      >{`CAPPED:${cappedPreview.slice(0, 24)}`}</Text>
    );
  }
  return (
    <Text color={Colors.Foreground}>
      {`EXPANDED:len=${body.length}:head=${body.slice(0, 12)}:tail=${body.slice(-10)}`}
    </Text>
  );
}

function TestHarness({
  turnStore,
  getTranscriptFilePath,
  callId,
  cappedPreview,
  constrainHeight,
}: {
  turnStore: ReturnType<typeof createTurnStore>;
  getTranscriptFilePath: () => string;
  callId: string;
  cappedPreview: string;
  constrainHeight: boolean;
}) {
  return (
    <TerminalProvider store={createTerminalStore({ constrainHeight })}>
      <TurnProvider store={turnStore}>
        <ToolResultExpansionProvider
          getTranscriptFilePath={getTranscriptFilePath}
        >
          <Probe callId={callId} cappedPreview={cappedPreview} />
        </ToolResultExpansionProvider>
      </TurnProvider>
    </TerminalProvider>
  );
}

describe('ToolResultExpansionProvider — load on expand, purge on append (#3428)', () => {
  let tempDir: string;
  let service: SessionRecordingService;
  let turnStore: ReturnType<typeof createTurnStore>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '3428-provider-'));
    service = new SessionRecordingService({
      sessionId: 'test-session-3428-provider',
      projectHash: 'testhash',
      chatsDir: tempDir,
      workspaceDirs: [tempDir],
      provider: 'fake',
      model: 'fake-model',
    });
    turnStore = createTurnStore();
  });

  afterEach(async () => {
    await service.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads the exact original body when constraints are lifted, then purges on append', async () => {
    const body = `FULL-start\n${'x'.repeat(300 * KIB)}\nFULL-end`;
    const capped = boundResultDisplayForRetention(body);
    expect(capped.wasCapped).toBe(true);
    service.recordContent(toolResponseContent('call-1', body));
    await service.flush();
    const transcriptPath = service.getFilePath() as string;

    const { lastFrame } = render(
      <TestHarness
        turnStore={turnStore}
        getTranscriptFilePath={() => transcriptPath}
        callId="call-1"
        cappedPreview={capped.text}
        constrainHeight={false}
      />,
    );

    // Constraints lifted: the full body replaces the capped preview, byte for
    // byte with the original string.
    await waitFor(() => {
      expect(lastFrame()).toContain(
        `EXPANDED:len=${body.length}:head=${body.slice(0, 12)}:tail=${body.slice(-10)}`,
      );
    });

    // Scroll-forward: a new history append purges the expansion and the
    // capped preview renders again — and stays capped (no immediate
    // re-expansion while constraints remain lifted).
    act(() => {
      turnStore.commands.addItem(
        { type: 'user', text: 'next turn' },
        Date.now(),
      );
    });
    expect(lastFrame()).toContain(`CAPPED:${capped.text.slice(0, 24)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).toContain(`CAPPED:${capped.text.slice(0, 24)}`);
  });

  it('does not fetch while height constraints are enabled', async () => {
    const body = 'small body';
    service.recordContent(toolResponseContent('call-2', body));
    await service.flush();
    const transcriptPath = service.getFilePath() as string;

    const { lastFrame } = render(
      <TestHarness
        turnStore={turnStore}
        getTranscriptFilePath={() => transcriptPath}
        callId="call-2"
        cappedPreview="CAPPED-PREVIEW"
        constrainHeight={true}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).toContain('CAPPED:CAPPED-PREVIEW'.slice(0, 30));
    expect(lastFrame()).not.toContain('EXPANDED:');
  });

  it('re-expands after a purge once constraints are lifted again', async () => {
    const body = 'REEXPAND-start\n' + 'z'.repeat(100 * KIB) + '\nREEXPAND-end';
    const capped = boundResultDisplayForRetention(body);
    expect(capped.wasCapped).toBe(true);
    service.recordContent(toolResponseContent('call-3', body));
    await service.flush();
    const transcriptPath = service.getFilePath() as string;

    const harness = (constrainHeight: boolean) => (
      <TestHarness
        turnStore={turnStore}
        getTranscriptFilePath={() => transcriptPath}
        callId="call-3"
        cappedPreview={capped.text}
        constrainHeight={constrainHeight}
      />
    );

    const { lastFrame, rerender } = render(harness(true));
    expect(lastFrame()).toContain(`CAPPED:${capped.text.slice(0, 24)}`);

    rerender(harness(false));
    await waitFor(() => {
      expect(lastFrame()).toContain(`EXPANDED:len=${body.length}`);
    });

    // Re-enabling constraints keeps the already-fetched body (retention stays
    // bounded to the expansion map; nothing extra is retained).
    rerender(harness(true));
    expect(lastFrame()).toContain(`EXPANDED:len=${body.length}`);

    // A scroll-forward purge drops it; lifting constraints again re-arms the
    // fetch and the full body comes back from the transcript.
    act(() => {
      turnStore.commands.addItem(
        { type: 'user', text: 'next turn' },
        Date.now(),
      );
    });
    await waitFor(() => {
      expect(lastFrame()).toContain(`CAPPED:${capped.text.slice(0, 24)}`);
    });

    rerender(harness(false));
    await waitFor(() => {
      expect(lastFrame()).toContain(`EXPANDED:len=${body.length}`);
    });
  });

  it('handles a rejecting transcript read and retries on the next lift', async () => {
    const body = `FAILRETRY-start
${'f'.repeat(100 * KIB)}
FAILRETRY-end`;
    const capped = boundResultDisplayForRetention(body);
    expect(capped.wasCapped).toBe(true);
    service.recordContent(toolResponseContent('call-fail-retry', body));
    await service.flush();
    const realTranscriptPath = service.getFilePath() as string;

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      // Phase 1: the transcript path is a directory, so the transcript
      // read rejects (EISDIR) instead of resolving.
      let transcriptPath: string = tempDir;
      const accessor = (): string => transcriptPath;
      const harness = (constrainHeight: boolean) => (
        <TestHarness
          turnStore={turnStore}
          getTranscriptFilePath={accessor}
          callId="call-fail-retry"
          cappedPreview={capped.text}
          constrainHeight={constrainHeight}
        />
      );

      const { lastFrame, rerender } = render(harness(false));
      expect(lastFrame()).toContain(`CAPPED:${capped.text.slice(0, 24)}`);
      // Give the rejection a window to surface; it must be handled, and
      // the capped preview keeps rendering.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(lastFrame()).toContain(`CAPPED:${capped.text.slice(0, 24)}`);
      expect(unhandled).toStrictEqual([]);

      // Phase 2: the transcript becomes readable; the next constraints
      // lift retries the fetch and the full body renders.
      transcriptPath = realTranscriptPath;
      rerender(harness(true));
      rerender(harness(false));
      await waitFor(() => {
        expect(lastFrame()).toContain(`EXPANDED:len=${body.length}`);
      });
      expect(unhandled).toStrictEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
