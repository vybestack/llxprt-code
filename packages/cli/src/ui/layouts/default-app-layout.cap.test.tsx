/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, mkdtemp, writeFile as write } from 'node:fs/promises';
import { resolve } from 'node:path';
import { act } from 'react';
import headless from '@xterm/headless';
import stripAnsi from 'strip-ansi';
import type { HistoryItem } from '../types.js';
import type { TurnStore } from '../stores/turn/turnStore.js';

interface Fiber {
  type?: { name?: string } | string | null;
  flags: number;
  memoizedProps?: { item?: HistoryItem; internal_static?: boolean };
  child: Fiber | null;
  sibling: Fiber | null;
}
let renderedIds: number[] = [];
let mountedItems = 0;
let staticOwners = 0;
function observe(fiber: Fiber | null): void {
  if (!fiber) return;
  const name =
    typeof fiber.type === 'function' || typeof fiber.type === 'object'
      ? fiber.type?.name
      : undefined;
  if (name === 'HistoryItemDisplay' && fiber.memoizedProps?.item) {
    mountedItems += 1;
    if ((fiber.flags & 1) !== 0) renderedIds.push(fiber.memoizedProps.item.id);
  }
  if (fiber.memoizedProps?.internal_static === true) staticOwners += 1;
  observe(fiber.child);
  observe(fiber.sibling);
}
const devtoolsDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  '__REACT_DEVTOOLS_GLOBAL_HOOK__',
);
Reflect.set(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
  supportsFiber: true,
  inject: () => 1,
  onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
    mountedItems = 0;
    staticOwners = 0;
    observe(root.current);
  },
  onCommitFiberUnmount: () => {},
});
void vi.mock('is-in-ci', () => ({ default: false }));
const realInk: typeof import('ink') = await import(import.meta.resolve('ink'));
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

const MAX_BYTES = 4 * 1024 * 1024;
const HEADER = '3434_HEADER';
const metrics: object[] = [];
const evidenceRoot = resolve(import.meta.dir, '../../../../../tmp/verify3434');
await mkdir(evidenceRoot, { recursive: true });
const evidenceDirectory = await mkdtemp(resolve(evidenceRoot, 'cap-'));
const actEnvironment = Object.getOwnPropertyDescriptor(
  globalThis,
  'IS_REACT_ACT_ENVIRONMENT',
);

function message(id: number, text = `MSG_${id}_END`): HistoryItem {
  return { id, type: 'gemini_content', text: `**${text}**` };
}
function count(text: string, sentinel: string): number {
  return text.split(sentinel).length - 1;
}
function serializedBytes(items: readonly HistoryItem[]): number {
  return items.reduce(
    (sum, item) => sum + Buffer.byteLength(JSON.stringify(item)),
    0,
  );
}
function sizedMessage(
  id: number,
  bytes: number,
  multibyte = false,
): HistoryItem {
  const empty: HistoryItem = { id, type: 'gemini_content', text: '```\n\n```' };
  const budget = bytes - serializedBytes([empty]);
  const line = (multibyte ? '界' : 'x').repeat(20) + '\n';
  const lineBytes = Buffer.byteLength(line) + 1;
  return {
    ...empty,
    text:
      '```\n' +
      line.repeat(Math.floor(budget / lineBytes)) +
      'x'.repeat(budget % lineBytes) +
      '\n```',
  };
}
interface Delta {
  terminalText: string;
  text: string;
  bytes: number;
  renderedIds: number[];
  mountedItems: number;
  staticOwners: number;
}
interface Harness {
  turn: TurnStore;
  initial: Delta;
  update: (command: () => void) => Promise<Delta>;
  resize: (width: number, height: number) => Promise<Delta>;
}
async function settle(): Promise<void> {
  await act(async () => {
    await sleep(40);
  });
}
async function withLayout(
  history: HistoryItem[],
  maxItems: number,
  run: (harness: Harness) => Promise<void>,
  header = false,
  screenReader = false,
): Promise<void> {
  const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const suppress = process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER;
  const dev = process.env.DEV;
  process.env.DEV = 'true';
  process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER = header ? 'false' : 'true';
  Object.defineProperties(process.stdout, {
    columns: { configurable: true, writable: true, value: 100 },
    rows: { configurable: true, writable: true, value: 40 },
  });
  let output = '';
  const emulator = new headless.Terminal({
    cols: 100,
    rows: 40,
    scrollback: 10000,
    convertEol: true,
    allowProposedApi: true,
  });
  renderedIds = [];
  const capture = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      const text =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      output += text;
      emulator.write(text);
      return true;
    });
  const terminal = createTerminalStore({
    terminalWidth: 100,
    terminalHeight: 40,
    mainAreaWidth: 100,
    constrainHeight: true,
    availableTerminalHeight: 37,
    isInputActive: false,
  });
  const turn = createTurnStore();
  turn.commands.setHistoryLimits({ maxItems, maxBytes: MAX_BYTES });
  turn.commands.loadHistory(history);
  const settings = createMockSettings({
    ui: {
      useAlternateBuffer: screenReader,
      hideContextSummary: true,
      hideFooter: true,
      hideTips: true,
      showTodoPanel: false,
    },
  });
  const config = new Config({
    sessionId: 'cap-3434',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
    accessibility: { screenReader },
  });
  let view: ReturnType<typeof realInk.render> | undefined;
  act(() => {
    view = realInk.render(
      wrapWithProviders(
        <TerminalProvider store={terminal}>
          <TurnProvider store={turn}>
            <DefaultAppLayout
              uiRuntime={buildUiRuntimeFromSource(config)}
              slashCommandRuntime={buildSlashCommandRuntime(config)}
              settings={settings}
              startupWarnings={[]}
              version={HEADER}
              nightly={true}
              mainControlsRef={{ current: null }}
              rootUiRef={{ current: null }}
              pendingHistoryItemRef={{ current: null }}
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
        isScreenReaderEnabled: screenReader,
        maxFps: 60,
      },
    );
  });
  async function take(): Promise<Delta> {
    await new Promise<void>((resolve) => {
      emulator.write('', resolve);
    });
    const buffer = emulator.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    }
    const delta = {
      terminalText: lines.join('\n'),
      text: stripAnsi(output),
      bytes: Buffer.byteLength(output),
      renderedIds,
      mountedItems,
      staticOwners,
    };
    output = '';
    renderedIds = [];
    return delta;
  }
  async function update(command: () => void): Promise<Delta> {
    await act(async () => {
      command();
    });
    await settle();
    return take();
  }
  try {
    await settle();
    await run({
      turn,
      initial: await take(),
      update,
      resize: async (width, height): Promise<Delta> =>
        update(() => {
          process.stdout.columns = width;
          process.stdout.rows = height;
          emulator.resize(width, height);
          process.stdout.emit('resize');
          terminal.commands.setDimensions({
            terminalWidth: width,
            terminalHeight: height,
            inputWidth: width - 16,
            suggestionsWidth: width - 20,
          });
          terminal.commands.setMainAreaWidth(width);
        }),
    });
  } finally {
    act(() => {
      view?.unmount();
    });
    capture.mockRestore();
    emulator.dispose();
    if (columns) Object.defineProperty(process.stdout, 'columns', columns);
    else Reflect.deleteProperty(process.stdout, 'columns');
    if (rows) Object.defineProperty(process.stdout, 'rows', rows);
    else Reflect.deleteProperty(process.stdout, 'rows');
    if (suppress === undefined)
      delete process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER;
    else process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER = suppress;
    if (dev === undefined) delete process.env.DEV;
    else process.env.DEV = dev;
  }
}

describe('bounded production standard-buffer emission', () => {
  beforeAll(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  });
  afterAll(async () => {
    if (devtoolsDescriptor)
      Object.defineProperty(
        globalThis,
        '__REACT_DEVTOOLS_GLOBAL_HOOK__',
        devtoolsDescriptor,
      );
    else Reflect.deleteProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
    if (actEnvironment)
      Object.defineProperty(
        globalThis,
        'IS_REACT_ACT_ENVIRONMENT',
        actEnvironment,
      );
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    await write(
      resolve(evidenceDirectory, 'cap-metrics.json'),
      JSON.stringify(metrics, null, 2),
    );
  });

  it('keeps screen-reader output on the standard transcript path even with alternate-buffer settings', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, initial, update, resize }) => {
        expect(initial.text).toContain('MSG_1_END');
        const delta = await update(() => {
          turn.commands.addItem(
            { type: 'gemini_content', text: 'ACCESSIBLE3434' },
            -100,
            true,
          );
        });
        expect(count(delta.text, 'ACCESSIBLE3434')).toBe(1);
        expect(delta.text).not.toContain('MSG_2_END');
        expect((await resize(40, 4)).text).not.toContain('ACCESSIBLE3434');
        const refresh = await update(() => {
          turn.commands.refreshStatic();
        });
        expect(count(refresh.text, 'ACCESSIBLE3434')).toBe(1);
        expect(count(refresh.text, 'MSG_2_END')).toBe(1);
      },
      false,
      true,
    );
  });

  it('keeps newly committed output visible when live pending content overflows a short terminal', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, update, resize }) => {
        await update(() => {
          turn.commands.setPendingHistoryItems([
            {
              type: 'gemini_content',
              text: Array.from(
                { length: 12 },
                (_, index) =>
                  `Pending paragraph ${index} with several words to wrap.`,
              ).join('\n\n'),
            },
          ]);
        });
        await resize(40, 4);
        const delta = await update(() => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'VISIBLE3434',
          });
        });
        expect(count(delta.text, 'VISIBLE3434')).toBe(1);
        expect(delta.terminalText).toContain('VISIBLE3434');
        expect(delta.text).not.toContain('MSG_1_END');
      },
    );
  });

  it('emits C and D once after A/B hit cap 2, without replaying history or header', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, initial, update, resize }) => {
        expect(count(initial.text, HEADER)).toBe(1);
        expect(count(initial.text, 'MSG_1_END')).toBe(1);
        for (const label of ['C3434', 'D3434', 'E3434']) {
          const delta = await update(() => {
            turn.commands.addItem({
              type: 'gemini_content',
              text: `**${label}**`,
            });
          });
          expect(count(delta.text, label)).toBe(1);
          expect(delta.text).not.toContain('MSG_1_END');
          expect(delta.text).not.toContain('MSG_2_END');
          expect(delta.text).not.toContain(HEADER);
          expect(turn.store.getState().history).toHaveLength(2);
        }
        const resized = await resize(30, 4);
        expect(resized.text).not.toContain('D3434');
        expect(resized.renderedIds).toHaveLength(0);
        const delta = await update(() => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'NEW_WIDTH words follow the narrow terminal and wrap here.',
          });
        });
        expect(delta.text).toContain('NEW_WIDTH words follow\n');
        expect(turn.store.getState().staticKey).toBe(0);
      },
      true,
    );
  });

  it('reports genuine evictions outside the budget and resets on clear/load with overlapping IDs', async () => {
    await withLayout([message(1), message(2)], 2, async ({ turn, update }) => {
      const c = await update(() => {
        turn.commands.addItem({ type: 'gemini_content', text: 'C3434' });
      });
      expect(c.text).toContain('[1 earlier messages truncated]');
      const d = await update(() => {
        turn.commands.addItem({ type: 'gemini_content', text: 'D3434' });
      });
      expect(d.text).toContain('[2 earlier messages truncated]');
      await update(() => {
        turn.commands.clearItems();
      });
      const loaded = await update(() => {
        turn.commands.loadHistory([message(1, 'REPLACEMENT3434'), message(2)]);
      });
      expect(count(loaded.text, 'REPLACEMENT3434')).toBe(1);
      expect(count(loaded.text, 'MSG_2_END')).toBe(1);
      expect(loaded.text).not.toContain('earlier messages truncated');
      const replay = await update(() => {
        turn.commands.loadHistory([message(1, 'SAME_ID3434'), message(2)]);
      });
      expect(count(replay.text, 'SAME_ID3434')).toBe(1);
      expect(count(replay.text, 'MSG_2_END')).toBe(1);
      const cappedLoad = await update(() => {
        turn.commands.loadHistory([
          message(7),
          message(8),
          message(9),
          message(10),
        ]);
      });
      expect(cappedLoad.text).toContain('[2 earlier messages truncated]');
      expect(cappedLoad.text).not.toContain('MSG_7_END');
      expect(count(cappedLoad.text, 'MSG_10_END')).toBe(1);
    });
  });

  it('refreshes only retained markdown, handles retractions, lower timestamps and disjoint batches', async () => {
    await withLayout(
      [message(900), message(800)],
      2,
      async ({ turn, update }) => {
        const delta = await update(() => {
          turn.commands.removeItems([900]);
          turn.commands.addItem(
            { type: 'gemini_content', text: '**LOW_TIME3434**' },
            -100,
          );
        });
        expect(count(delta.text, 'LOW_TIME3434')).toBe(1);
        expect(delta.text).not.toContain('MSG_800_END');
        expect(delta.text).not.toContain('earlier messages truncated');
        const updated = await update(() => {
          turn.commands.updateItem(800, { text: '**UPDATED3434**' });
        });
        expect(updated.text).not.toContain('UPDATED3434');
        const refresh = await update(() => {
          turn.commands.refreshStatic();
        });
        expect(count(refresh.text, 'UPDATED3434')).toBe(1);
        expect(refresh.text).not.toContain('**UPDATED3434**');
        expect(refresh.text).not.toContain('MSG_900_END');
        const batch = await update(() => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'BATCH_F3434',
          });
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'BATCH_G3434',
          });
        });
        expect(count(batch.text, 'BATCH_F3434')).toBe(1);
        expect(count(batch.text, 'BATCH_G3434')).toBe(1);
        expect(batch.text.indexOf('BATCH_F3434')).toBeLessThan(
          batch.text.indexOf('BATCH_G3434'),
        );
        expect(batch.text).not.toContain('UPDATED3434');
        await update(() => {
          turn.commands.removeItems(
            turn.store.getState().history.map((item) => item.id),
          );
        });
        const appended = await update(() => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'AFTER_REMOVAL3434',
          });
        });
        expect(count(appended.text, 'AFTER_REMOVAL3434')).toBe(1);
      },
    );
  });

  it('emits only the appended suffix after removing the prior tail in the same commit', async () => {
    await withLayout(
      [message(90), message(80), message(70)],
      3,
      async ({ turn, update }) => {
        const delta = await update(() => {
          turn.commands.removeItems([70]);
          turn.commands.addItem(
            { type: 'gemini_content', text: 'TAIL_REPLACEMENT3434' },
            -200,
          );
        });
        expect(count(delta.text, 'TAIL_REPLACEMENT3434')).toBe(1);
        expect(delta.text).not.toContain('MSG_90_END');
        expect(delta.text).not.toContain('MSG_80_END');
        expect(delta.text).not.toContain('MSG_70_END');
        const removed = await update(() => {
          turn.commands.removeItems([90]);
        });
        expect(removed.renderedIds).toHaveLength(0);
        const appended = await update(() => {
          turn.commands.addItem(
            { type: 'gemini_content', text: 'AFTER_HEAD3434' },
            -300,
          );
        });
        expect(count(appended.text, 'AFTER_HEAD3434')).toBe(1);
        expect(appended.text).not.toContain('TAIL_REPLACEMENT3434');
      },
    );
  });

  it('does not emit no-ops or rejected items and does not count body fitting as a head eviction', async () => {
    await withLayout([], 2, async ({ turn, update }) => {
      const first = await update(() => {
        turn.commands.addItem({ type: 'user', text: 'DUP3434' });
      });
      expect(count(first.text, 'DUP3434')).toBe(1);
      const unchanged = await update(() => {
        turn.commands.addItem({ type: 'user', text: 'DUP3434' });
        turn.commands.updateItem(-1, { text: 'ABSENT3434' });
        turn.commands.removeItems([]);
      });
      expect(unchanged.text).not.toContain('DUP3434');
      expect(unchanged.renderedIds).toHaveLength(0);
      expect(turn.store.getState().historyTruncatedItems).toBe(0);
      await update(() => {
        turn.commands.clearItems();
      });
      const fitted = await update(() => {
        turn.commands.loadHistory([sizedMessage(8, MAX_BYTES + 1, true)]);
      });
      expect(
        serializedBytes(turn.store.getState().history),
      ).toBeLessThanOrEqual(MAX_BYTES);
      expect(turn.store.getState().historyTruncatedItems).toBe(0);
      expect(fitted.text).not.toContain('earlier messages truncated');
      await update(() => {
        turn.commands.setHistoryLimits({ maxItems: 0, maxBytes: 0 });
      });
      const rejected = await update(() => {
        turn.commands.addItem({ type: 'gemini_content', text: 'REJECTED3434' });
      });
      expect(rejected.text).not.toContain('REJECTED3434');
      expect(rejected.renderedIds).toHaveLength(0);
      expect(turn.store.getState().history).toHaveLength(0);
      expect(turn.store.getState().historyTruncatedItems).toBe(1);
    });
  });

  it('replays the header and bounded retained snapshot only on explicit refresh', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, update }) => {
        await update(() => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'RETAINED3434',
          });
        });
        const refreshed = await update(() => {
          turn.commands.refreshStatic();
        });
        expect(count(refreshed.text, HEADER)).toBe(1);
        expect(count(refreshed.text, 'MSG_2_END')).toBe(1);
        expect(count(refreshed.text, 'RETAINED3434')).toBe(1);
        expect(refreshed.text).not.toContain('MSG_1_END');
        expect(refreshed.text).toContain('[1 earlier messages truncated]');
      },
      true,
    );
  });

  it('emits the default 399/400/401 boundary and every later committed entry', async () => {
    await withLayout(
      Array.from({ length: 399 }, (_, id) => message(id)),
      400,
      async ({ turn, initial, update }) => {
        expect(count(initial.text, 'MSG_398_END')).toBe(1);
        for (let n = 399; n < 440; n += 1) {
          const oldIds = new Set(
            turn.store.getState().history.map((item) => item.id),
          );
          const delta = await update(() => {
            turn.commands.addItem({
              type: 'gemini_content',
              text: `SEQ_${n}_END`,
            });
          });
          expect(count(delta.text, `SEQ_${n}_END`)).toBe(1);
          expect(delta.renderedIds.filter((id) => oldIds.has(id))).toHaveLength(
            0,
          );
          expect(delta.text).not.toContain('MSG_398_END');
        }
        expect(turn.store.getState().history).toHaveLength(400);
      },
    );
  }, 30000);

  it.each([false, true])(
    'retains exactly 4MiB serialized UTF8 and counts multiple head evictions (multibyte %s)',
    async (multibyte) => {
      const small = [message(1), message(2)];
      const large = sizedMessage(
        3,
        MAX_BYTES - serializedBytes(small),
        multibyte,
      );
      expect(serializedBytes([...small, large])).toBe(MAX_BYTES);
      await withLayout([...small, large], 400, async ({ turn, update }) => {
        expect(serializedBytes(turn.store.getState().history)).toBe(MAX_BYTES);
        const delta = await update(() => {
          turn.commands.addItem({
            type: 'gemini_content',
            text: 'MULTI_HEAD3434'.repeat(20),
          });
        });
        expect(delta.text).toContain('MULTI_HEAD3434');
        expect(delta.text).toContain('[3 earlier messages truncated]');
        expect(turn.store.getState().history).toHaveLength(1);
        expect(
          serializedBytes(turn.store.getState().history),
        ).toBeLessThanOrEqual(MAX_BYTES);
      });
    },
    30000,
  );

  it.each([
    [25, false],
    [100, false],
    [400, false],
    [400, true],
  ] satisfies Array<[number, boolean]>)(
    'keeps committed renders and emitted bytes delta-sized after cap %s over 220 commits (near byte cap %s)',
    async (cap, nearBytes) => {
      const initialHistory = Array.from({ length: cap }, (_, id) =>
        message(id),
      );
      if (nearBytes) {
        initialHistory[cap - 1] = sizedMessage(
          cap - 1,
          MAX_BYTES - 4096 - serializedBytes(initialHistory.slice(0, -1)),
          true,
        );
      }
      await withLayout(
        initialHistory,
        cap,
        async ({ turn, initial, update }) => {
          expect(initial.renderedIds.length).toBeGreaterThanOrEqual(cap);
          expect(initial.staticOwners).toBe(1);
          const samples: number[] = [];
          const retainedByteSamples: number[] = [];
          let oldRenders = 0;
          for (let n = 0; n < 220; n += 1) {
            const oldIds = new Set(
              turn.store.getState().history.map((item) => item.id),
            );
            const delta = await update(() => {
              turn.commands.addItem({
                type: 'gemini_content',
                text: `CHURN_${String(n).padStart(3, '0')}_END`,
              });
            });
            expect(
              count(delta.text, `CHURN_${String(n).padStart(3, '0')}_END`),
            ).toBe(1);
            oldRenders += delta.renderedIds.filter((id) =>
              oldIds.has(id),
            ).length;
            expect(delta.mountedItems).toBe(0);
            expect(delta.staticOwners).toBe(1);
            expect(delta.renderedIds).toHaveLength(1);
            expect(delta.text.match(/CHURN_\d{3}_END/g)).toStrictEqual([
              `CHURN_${String(n).padStart(3, '0')}_END`,
            ]);
            expect(turn.store.getState().history).toHaveLength(cap);
            const retainedBytes = serializedBytes(
              turn.store.getState().history,
            );
            expect(retainedBytes).toBeLessThanOrEqual(MAX_BYTES);
            expect(retainedBytes).toBeGreaterThan(
              nearBytes ? MAX_BYTES - 8192 : 0,
            );
            samples.push(delta.bytes);
            retainedByteSamples.push(retainedBytes);
          }
          expect(oldRenders).toBe(0);
          expect(Math.max(...samples)).toBeLessThan(350);
          metrics.push({
            cap,
            nearBytes,
            commits: samples.length,
            oldRenders,
            minBytes: Math.min(...samples),
            maxBytes: Math.max(...samples),
            minRetainedBytes: Math.min(...retainedByteSamples),
            maxRetainedBytes: Math.max(...retainedByteSamples),
            meanBytes:
              samples.reduce((sum, bytes) => sum + bytes, 0) / samples.length,
          });
        },
      );
    },
    30000,
  );
});
