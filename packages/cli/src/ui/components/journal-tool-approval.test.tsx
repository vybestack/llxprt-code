/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import type {
  ToolCallRequestInfo,
  ToolConfirmationOutcome as Outcome,
} from '@vybestack/llxprt-code-core';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => ({
    getEphemeralSetting: () => undefined,
    getWorkspaceDirectories: () => [],
  }),
}));
const { renderWithProviders, wrapWithProviders, waitFor } = await import(
  '../../__tests__/render.js'
);
const { installWorkspaceRuntimeFixture } = await import(
  '../../__tests__/workspace-runtime-fixture.js'
);
const runtimeFixture = installWorkspaceRuntimeFixture();
const { Config, ToolConfirmationOutcome } = await import(
  '@vybestack/llxprt-code-core'
);
const { HistoryService } = await import(
  '@vybestack/llxprt-code-core/services/history/HistoryService.js'
);
const { createSessionRecorder } = await import(
  '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js'
);
const { useTempDir } = await import(
  '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js'
);
const { createScrollbackPagerStore } = await import(
  '../stores/turn/scrollbackPager.js'
);
const { ScrollbackViewport } = await import('./ScrollbackViewport.js');
import { ToolCallStatus, type HistoryItemWithoutId } from '../types.js';

type Identity = NonNullable<ToolCallRequestInfo['journalIdentity']>;
async function request(
  history: InstanceType<typeof HistoryService>,
  id: string,
): Promise<Identity> {
  const arrival = await history.openResponseArrival({
    id,
    submissionId: 'submission',
  });
  await arrival.append({
    type: 'tool_call',
    id,
    name: 'lookup',
    parameters: { query: 'disk request' },
  });
  await arrival.seal({});
  return arrival.identity;
}
function control(
  id: string,
  identity: Identity,
  onConfirm: (outcome: Outcome) => Promise<void>,
): HistoryItemWithoutId {
  return {
    type: 'tool_group',
    tools: [
      {
        callId: id,
        journalIdentity: identity,
        name: 'control-name',
        description: '',
        status: ToolCallStatus.Confirming,
        resultDisplay: undefined,
        confirmationDetails: {
          type: 'info',
          title: 'Approve disk lookup',
          prompt: 'Run lookup?',
          onConfirm,
        },
      },
    ],
  };
}
async function fixture(root: string) {
  const recording = createSessionRecorder({
    sessionId: 'approval',
    projectHash: 'approval',
    chatsDir: root,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const history = new HistoryService();
  await history.attachJournal(recording, true);
  const identity = await request(history, 'approval-call');
  const path = history.journalPath();
  if (path === null) throw new Error('Missing journal');
  const viewport = {
    visibleKeys: [],
    viewportLines: 20,
    rowHeightLines: () => 1,
  };
  const pager = createScrollbackPagerStore({
    filePath: path,
    viewport,
    pageRows: 4,
    settings: { marginViewports: 1, byteFloorBytes: 65536, purgeDebounceMs: 0 },
  });
  await pager.resumeFromJournal();
  const config = runtimeFixture(
    new Config({
      sessionId: 'approval-ui',
      targetDir: root,
      cwd: root,
      model: 'test',
      debugMode: false,
      trustedFolder: true,
    }),
  );
  return {
    history,
    identity,
    pager,
    element: (pending: HistoryItemWithoutId[]) => (
      <ScrollbackViewport
        store={pager}
        viewport={viewport}
        viewportLines={20}
        pollMs={10}
        config={config}
        pendingToolControls={pending}
      />
    ),
    close: async (): Promise<void> => {
      await pager.close();
      await history.dispose();
      await recording.dispose();
    },
  };
}

describe('mounted journal tool approval', () => {
  const directory = useTempDir('mounted-journal-approval-');
  it('shows a focusable approval at its disk row and removes callbacks after completion', async () => {
    const f = await fixture(directory());
    let decision: Outcome | undefined;
    const view = renderWithProviders(
      f.element([
        control('approval-call', f.identity, async (outcome) => {
          decision = outcome;
        }),
      ]),
    );
    try {
      await waitFor(() => expect(view.lastFrame()).toContain('Allow once'));
      expect(view.lastFrame()).toContain('lookup');
      expect(view.lastFrame()).not.toContain('control-name');
      await act(async () => {
        view.stdin.write('\r');
        await Bun.sleep(30);
      });
      await waitFor(() =>
        expect(decision).toBe(ToolConfirmationOutcome.ProceedOnce),
      );
      await act(async () => {
        await f.history.addBatch([
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'approval-call',
                toolName: 'lookup',
                result: 'model-facing result',
              },
            ],
          },
        ]);
        await f.history.appendDisplay(
          {
            type: 'tool-result',
            attemptId: f.identity.attemptId,
            callId: 'approval-call',
            format: 'text',
          },
          'finished journal result',
        );
        view.rerender(wrapWithProviders(f.element([])));
        await Bun.sleep(30);
      });
      await waitFor(() =>
        expect(view.lastFrame()).toContain('finished journal result'),
      );
      expect(view.lastFrame()).not.toContain('Allow once');
      expect(
        f.pager.getState().rows.filter((row) => row.item.type === 'tool_group'),
      ).toHaveLength(1);
    } finally {
      view.unmount();
      await f.close();
    }
  });

  it('routes a keypress to just one approval when multiple journal cards are visible', async () => {
    const f = await fixture(directory());
    const second = await request(f.history, 'second-call');
    await f.pager.pageForward();
    const decisions: Array<{ call: string; outcome: Outcome }> = [];
    const controls = [
      control('approval-call', f.identity, async (outcome) => {
        decisions.push({ call: 'first', outcome });
      }),
      control('second-call', second, async (outcome) => {
        decisions.push({ call: 'second', outcome });
      }),
    ];
    const view = renderWithProviders(f.element(controls));
    try {
      await waitFor(() =>
        expect(view.lastFrame()?.match(/Allow once/g)).toHaveLength(2),
      );
      await act(async () => {
        view.stdin.write('\r');
        await Bun.sleep(30);
      });
      expect(decisions).toStrictEqual([
        { call: 'first', outcome: ToolConfirmationOutcome.ProceedOnce },
      ]);
      await act(async () => {
        view.rerender(wrapWithProviders(f.element(controls.slice(1))));
        await Bun.sleep(30);
        view.stdin.write('\u001b[B');
        await Bun.sleep(30);
        view.stdin.write(String.fromCharCode(13));
        await Bun.sleep(30);
      });
      expect(decisions).toStrictEqual([
        { call: 'first', outcome: ToolConfirmationOutcome.ProceedOnce },
        { call: 'second', outcome: ToolConfirmationOutcome.ProceedAlways },
      ]);
    } finally {
      view.unmount();
      await f.close();
    }
  });
});
