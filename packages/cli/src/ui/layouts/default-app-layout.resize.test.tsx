/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, mkdtemp, writeFile as write } from 'node:fs/promises';
import { act } from 'react';
import type { DOMElement } from 'ink';
import { resolve } from 'node:path';
import stripAnsi from 'strip-ansi';

void vi.mock('is-in-ci', () => ({ default: false }));
const realInk: typeof import('ink') = await import(import.meta.resolve('ink'));
const { render: renderInk, measureElement } = realInk;
void vi.mock('ink', () => realInk);
const runtimeContext = await import('../contexts/RuntimeContext.js');
void vi.mock('../contexts/RuntimeContext.js', () => ({
  ...runtimeContext,
  useRuntimeApi: () => ({
    getEphemeralSetting: () => undefined,
    getCliRuntimeServices: () => ({
      config: { getWorkspaceContext: () => ({ getDirectories: () => [] }) },
    }),
  }),
}));

const { Config } = await import('@vybestack/llxprt-code-core');
const { wrapWithProviders, createMockSettings } = await import(
  '../../__tests__/render.js'
);
const { DefaultAppLayout } = await import('./DefaultAppLayout.js');
const { buildSlashCommandRuntime, buildUiRuntimeFromSource } = await import(
  '../cliUiRuntime.js'
);
const { TerminalProvider } = await import(
  '../stores/terminal/TerminalContext.js'
);
const { TurnProvider } = await import('../stores/turn/TurnContext.js');
const { createTerminalStore } = await import(
  '../stores/terminal/terminalStore.js'
);
const { createTurnStore } = await import('../stores/turn/turnStore.js');
const { StreamingState } = await import('../types.js');
const { computeInputWidth, computeSuggestionsWidth, STATIC_EXTRA_HEIGHT } =
  await import('../utils/ui-sizing.js');

const OLD_HISTORY = 'OLD3434_COMMITTED';
const evidenceRoot = resolve(import.meta.dir, '../../../../../tmp/verify3434');
await mkdir(evidenceRoot, { recursive: true });
const evidenceDirectory = await mkdtemp(resolve(evidenceRoot, 'resize-'));
const actEnvironment = Object.getOwnPropertyDescriptor(
  globalThis,
  'IS_REACT_ACT_ENVIRONMENT',
);
interface Delta {
  label: string;
  columns: number;
  rows: number;
  liveHeight: number;
  staticKey: number;
  bytes: number;
  oldHistoryOccurrences: number;
  raw: string;
  text: string;
}

function occurrences(text: string, sentinel: string): number {
  return text.split(sentinel).length - 1;
}

function pendingText(paragraphs: number): string {
  return Array.from(
    { length: paragraphs },
    (_, index) =>
      `Pending ${index}: streaming prose fills the current terminal width with words.`,
  ).join('\n\n');
}

async function settle(): Promise<void> {
  await act(async () => {
    await sleep(120);
  });
}

function renderInAct(
  ...args: Parameters<typeof renderInk>
): ReturnType<typeof renderInk> {
  let view: ReturnType<typeof renderInk> | undefined;
  act(() => {
    view = renderInk(...args);
  });
  if (!view) throw new Error('Ink render did not return an instance');
  return view;
}

async function withLayout(
  name: string,
  paragraphs: number,
  run: (harness: {
    resize: (columns: number, rows: number) => Promise<Delta[]>;
    setPending: (paragraphs: number) => Promise<Delta>;
    append: () => Promise<Delta>;
    clear: () => Promise<Delta>;
    recalculateLayout: () => Promise<Delta>;
    initial: Delta;
  }) => Promise<void>,
): Promise<void> {
  const columnsDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    'columns',
  );
  const rowsDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    'rows',
  );
  const suppressHeader = process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER;
  process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER = 'true';
  Object.defineProperties(process.stdout, {
    columns: { configurable: true, writable: true, value: 100 },
    rows: { configurable: true, writable: true, value: 40 },
  });
  let writes: string[] = [];
  const capture = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    });
  const deltas: Delta[] = [];
  const terminal = createTerminalStore({
    terminalWidth: 100,
    terminalHeight: 40,
    mainAreaWidth: 100,
    inputWidth: computeInputWidth(100),
    suggestionsWidth: computeSuggestionsWidth(100),
    constrainHeight: true,
    availableTerminalHeight: 37,
    isInputActive: false,
  });
  const turn = createTurnStore({
    history: [{ id: 1, type: 'gemini_content', text: `**${OLD_HISTORY}**` }],
    pendingHistoryItems:
      paragraphs === 0
        ? []
        : [{ type: 'gemini_content', text: pendingText(paragraphs) }],
    streamingState: StreamingState.WaitingForConfirmation,
    currentLoadingPhrase: 'Waiting for confirmation',
    ctrlCPressedOnce: true,
  });
  const settings = createMockSettings({
    ui: {
      useAlternateBuffer: false,
      hideContextSummary: true,
      hideFooter: true,
      showTodoPanel: false,
    },
  });
  const config = new Config({
    sessionId: `resize-3434-${name}`,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
  });
  const rootUiRef: { current: DOMElement | null } = { current: null };
  const mainControlsRef: { current: DOMElement | null } = { current: null };
  const pendingHistoryItemRef: { current: DOMElement | null } = {
    current: null,
  };
  const view = renderInAct(
    wrapWithProviders(
      <TerminalProvider store={terminal}>
        <TurnProvider store={turn}>
          <DefaultAppLayout
            uiRuntime={buildUiRuntimeFromSource(config)}
            slashCommandRuntime={buildSlashCommandRuntime(config)}
            settings={settings}
            startupWarnings={[]}
            version="test"
            nightly={false}
            mainControlsRef={mainControlsRef}
            rootUiRef={rootUiRef}
            pendingHistoryItemRef={pendingHistoryItemRef}
            contextFileNames={[]}
            updateInfo={null}
          />
        </TurnProvider>
      </TerminalProvider>,
      { settings },
    ),
    {
      stdout: process.stdout,
      patchConsole: false,
      exitOnCtrlC: false,
      isScreenReaderEnabled: false,
      maxFps: 30,
    },
  );

  function takeDelta(label: string): Delta {
    if (!rootUiRef.current) throw new Error('production layout did not mount');
    const raw = writes.join('');
    writes = [];
    const delta = {
      label,
      columns: process.stdout.columns,
      rows: process.stdout.rows,
      liveHeight: measureElement(rootUiRef.current).height,
      staticKey: turn.store.getState().staticKey,
      bytes: Buffer.byteLength(raw),
      oldHistoryOccurrences: occurrences(stripAnsi(raw), OLD_HISTORY),
      raw,
      text: stripAnsi(raw),
    };
    deltas.push(delta);
    return delta;
  }

  try {
    await settle();
    const initial = takeDelta('initial');
    expect(initial.oldHistoryOccurrences).toBe(1);
    expect(process.stdout.listenerCount('resize')).toBeGreaterThan(0);
    await run({
      initial,
      resize: async (columns, rows): Promise<Delta[]> => {
        process.stdout.columns = columns;
        process.stdout.rows = rows;
        process.stdout.emit('resize');
        await settle();
        const stream = takeDelta('stdout-resize');
        await act(async () => {
          terminal.commands.setDimensions({
            terminalWidth: columns,
            terminalHeight: rows,
            inputWidth: computeInputWidth(columns),
            suggestionsWidth: computeSuggestionsWidth(columns),
          });
          terminal.commands.setMainAreaWidth(columns);
          terminal.commands.setNarrow(columns < 80);
          const footerHeight = mainControlsRef.current
            ? measureElement(mainControlsRef.current).height
            : 0;
          terminal.commands.setFooterHeight(footerHeight);
          terminal.commands.setAvailableTerminalHeight(
            rows - footerHeight - STATIC_EXTRA_HEIGHT,
          );
        });
        await settle();
        return [stream, takeDelta('terminal-store-resize')];
      },
      setPending: async (count): Promise<Delta> => {
        await act(async () => {
          turn.commands.setPendingHistoryItems([
            { type: 'gemini_content', text: pendingText(count) },
          ]);
        });
        await settle();
        return takeDelta('pending-update');
      },
      append: async (): Promise<Delta> => {
        await act(async () => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'NEW3434_CURRENT_WIDTH prose continues after resize with many words to wrap.',
          });
        });
        await settle();
        return takeDelta('append');
      },
      clear: async (): Promise<Delta> => {
        view.clear();
        await settle();
        return takeDelta('public-clear');
      },
      recalculateLayout: async (): Promise<Delta> => {
        view.recalculateLayout();
        await settle();
        return takeDelta('public-recalculate-layout');
      },
    });
  } finally {
    act(() => {
      view.unmount();
    });
    capture.mockRestore();
    if (columnsDescriptor)
      Object.defineProperty(process.stdout, 'columns', columnsDescriptor);
    else Reflect.deleteProperty(process.stdout, 'columns');
    if (rowsDescriptor)
      Object.defineProperty(process.stdout, 'rows', rowsDescriptor);
    else Reflect.deleteProperty(process.stdout, 'rows');
    if (suppressHeader === undefined)
      delete process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER;
    else process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER = suppressHeader;
    await write(
      resolve(evidenceDirectory, `${name}.json`),
      JSON.stringify(deltas, null, 2),
    );
    await write(
      resolve(evidenceDirectory, `${name}.stdout`),
      deltas.map((delta) => delta.raw).join(''),
    );
  }
}

describe('production standard-buffer resize emission', () => {
  beforeAll(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  });
  afterAll(() => {
    if (actEnvironment)
      Object.defineProperty(
        globalThis,
        'IS_REACT_ACT_ENVIRONMENT',
        actEnvironment,
      );
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });

  it('does not replay committed history on a narrow resize with live content fitting the terminal', async () => {
    await withLayout(
      'narrow-fitting',
      1,
      async ({ resize, append }): Promise<void> => {
        const deltas = await resize(40, 40);
        const added = await append();
        expect(deltas.every((delta) => delta.liveHeight < delta.rows)).toBe(
          true,
        );
        expect(added.text).toContain(
          `NEW3434_CURRENT_WIDTH prose
  continues after resize with many
  words to wrap.`,
        );
        expect(
          [...deltas, added].map((delta) => delta.oldHistoryOccurrences),
        ).toStrictEqual([0, 0, 0]);
      },
    );
  });

  it('does not replay committed history when the terminal shrinks below the previous live height', async () => {
    await withLayout(
      'short-shrink',
      6,
      async ({ resize, initial }): Promise<void> => {
        expect(initial.liveHeight).toBeGreaterThan(4);
        const deltas = await resize(40, 4);
        expect(deltas.map((delta) => delta.staticKey)).toStrictEqual([
          initial.staticKey,
          initial.staticKey,
        ]);
        expect(
          deltas.map((delta) => delta.oldHistoryOccurrences),
        ).toStrictEqual([0, 0]);
      },
    );
  });

  it('does not replay committed history when width shrink makes pending content overflow', async () => {
    await withLayout(
      'narrow-overflow',
      12,
      async ({ resize, initial }): Promise<void> => {
        expect(initial.liveHeight).toBeLessThan(40);
        const deltas = await resize(30, 40);
        expect(deltas.some((delta) => delta.liveHeight >= delta.rows)).toBe(
          true,
        );
        expect(
          deltas.map((delta) => delta.oldHistoryOccurrences),
        ).toStrictEqual([0, 0]);
      },
    );
  });

  it('does not replay committed history across a narrow and short resize storm', async () => {
    await withLayout('resize-storm', 6, async ({ resize }): Promise<void> => {
      const deltas: Delta[] = [];
      for (const [columns, rows] of [
        [80, 30],
        [40, 4],
        [60, 12],
        [100, 40],
      ]) {
        deltas.push(...(await resize(columns, rows)));
      }
      expect(deltas.map((delta) => delta.oldHistoryOccurrences)).toStrictEqual(
        Array(8).fill(0),
      );
    });
  });

  it('does not replay committed history when live pending output exceeds terminal height', async () => {
    await withLayout(
      'pending-overflow',
      0,
      async ({ setPending, resize }): Promise<void> => {
        const pending = await setPending(30);
        const deltas = await resize(80, 24);
        expect(pending.liveHeight).toBeGreaterThan(40);
        expect(
          [pending, ...deltas].map((delta) => delta.oldHistoryOccurrences),
        ).toStrictEqual([0, 0, 0]);
      },
    );
  });

  it('does not replay committed history after public clear and layout recalculation during short resize', async () => {
    await withLayout(
      'public-controls',
      6,
      async ({ clear, resize, recalculateLayout }): Promise<void> => {
        const cleared = await clear();
        const deltas = await resize(40, 4);
        const recalculated = await recalculateLayout();
        expect(
          [cleared, ...deltas, recalculated].map(
            (delta) => delta.oldHistoryOccurrences,
          ),
        ).toStrictEqual([0, 0, 0, 0]);
      },
    );
  });
});
