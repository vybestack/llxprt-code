/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, mkdtemp, rm, writeFile as write } from 'node:fs/promises';
import { resolve } from 'node:path';
import { act } from 'react';
import headless from '@xterm/headless';
import stripAnsi from 'strip-ansi';
import {
  message,
  count,
  serializedBytes,
  sizedMessage,
} from './cap-payload.fixture.js';
import { rowIdentityKey } from '../utils/rowIdentity.js';
import type { HistoryItem, HistoryItemWithoutId } from '../types.js';
import { registerNativeCapScenarios } from './cap-native-scenarios.fixture.js';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from '../stores/turn/scrollbackPager.js';
import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { encodeJournalUiItem } from '../stores/turn/journal-ui-item.js';
import type { TurnStore } from '../stores/turn/turnStore.js';

interface Fiber {
  type?: { name?: string } | string | null;
  flags: number;
  memoizedProps?: { item?: HistoryItem; internal_static?: boolean };
  child: Fiber | null;
  sibling: Fiber | null;
}
let renderedKeys: string[] = [];
let mountedItems = 0;
let staticOwners = 0;
function observe(root: Fiber | null): void {
  const pending: Fiber[] = [];
  if (root) pending.push(root);
  while (pending.length > 0) {
    const fiber = pending.pop();
    if (!fiber) continue;
    const name =
      typeof fiber.type === 'function' || typeof fiber.type === 'object'
        ? fiber.type?.name
        : undefined;
    if (name === 'HistoryItemDisplay' && fiber.memoizedProps?.item) {
      mountedItems++;
      if ((fiber.flags & 1) !== 0)
        renderedKeys.push(
          fiber.memoizedProps.item.rowIdentity
            ? rowIdentityKey(fiber.memoizedProps.item.rowIdentity)
            : String(fiber.memoizedProps.item.id),
        );
    }
    if (fiber.memoizedProps?.internal_static === true) staticOwners++;
    if (fiber.sibling) pending.push(fiber.sibling);
    if (fiber.child) pending.push(fiber.child);
  }
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
const selectedRuntimeMock1 = (() =>
  (() => {
    const useSelectedTestRuntime = () => ({
      getEphemeralSetting: () => undefined,
      getWorkspaceDirectories: () => [],
    });
    return {
      ...runtimeContext,

      useGetEphemeralSetting: () =>
        useSelectedTestRuntime().getEphemeralSetting,

      useGetWorkspaceDirectories: () =>
        useSelectedTestRuntime().getWorkspaceDirectories,

      useRuntimeApi: useSelectedTestRuntime,
    };
  })())();
void vi.mock('../contexts/RuntimeContext.js', () => selectedRuntimeMock1);
void vi.mock(
  '../../__tests__/runtime-context-fixture.js',
  () => selectedRuntimeMock1,
);
const { Config } = await import('@vybestack/llxprt-code-core');
const { createUiSessionOwner } = await import(
  '../../__tests__/uiSessionOwner.js'
);
const { wrapWithProviders, createMockSettings, waitFor } = await import(
  '../../__tests__/render.js'
);
const { DefaultAppLayout } = await import('./DefaultAppLayout.js');
const { buildUiRuntimeFromSource } = await import(
  '../../__tests__/ui-runtime-composition-fixture.js'
);
const { buildLayoutRuntimeForTest } = await import(
  '../../__tests__/slash-command-runtime-fixture.js'
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

interface Delta {
  terminalText: string;
  text: string;
  bytes: number;
  renderedKeys: string[];
  mountedItems: number;
  staticOwners: number;
}
export interface Harness {
  turn: TurnStore;
  pager: ScrollbackPagerStore;
  writer: JournalDisplayWriter;
  session: JournalSession;
  append: (
    item: Extract<HistoryItemWithoutId, { type: 'gemini_content' }>,
  ) => Promise<Delta>;
  durableRows: () => Promise<number>;
  initial: Delta;
  update: (command: () => void | Promise<void>) => Promise<Delta>;
  resize: (width: number, height: number) => Promise<Delta>;
}
async function settle(): Promise<void> {
  await act(async () => {
    await sleep(110);
  });
  await act(async () => {
    await sleep(0);
  });
}
async function withLayout(
  history: HistoryItem[],
  maxItems: number,
  run: (harness: Harness) => Promise<void>,
  header = false,
  screenReader = false,
  captureTerminal = true,
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
  const emulator = captureTerminal
    ? new headless.Terminal({
        cols: 100,
        rows: 40,
        scrollback: 10000,
        convertEol: true,
        allowProposedApi: true,
      })
    : undefined;
  renderedKeys = [];
  const capture = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      const text =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      output += text;
      emulator?.write(text);
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
  const directory = await mkdtemp(resolve(evidenceDirectory, 'journal-'));
  const filePath = resolve(directory, 'session.llxj');
  const session = await JournalSession.create(filePath);
  const writer = new JournalDisplayWriter(session.store);
  for (const item of history)
    await writer.append({ type: 'ui-item' }, encodeJournalUiItem(item));
  const viewport = {
    visibleKeys: [],
    viewportLines: maxItems,
    rowHeightLines: () => 1,
  };
  const pager = createScrollbackPagerStore({
    filePath,
    viewport,
    pageRows: maxItems,
    settings: { marginViewports: 0, byteFloorBytes: 256, purgeDebounceMs: 0 },
  });
  await pager.resumeFromJournal();
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
  const owner = await createUiSessionOwner(config);
  let view: ReturnType<typeof realInk.render> | undefined;
  act(() => {
    const uiRuntime = buildUiRuntimeFromSource(config, owner);
    view = realInk.render(
      wrapWithProviders(
        <TerminalProvider store={terminal}>
          <TurnProvider store={turn}>
            <DefaultAppLayout
              subscribeContextRange={() => () => {}}
              scrollbackPager={{ store: pager, viewport }}
              readIdeMode={() => false}
              readIdeDiffingEnabled={() => false}
              subscribeIdeDiffing={() => () => {}}
              resolveIdeDiff={async () => {}}
              readIdeWorkspaceTrust={() => undefined}
              subscribeIdeWorkspaceTrust={() => () => {}}
              screenReaderEnabled={uiRuntime.app.getScreenReader()}
              disableLoadingPhrases={
                uiRuntime.app.getAccessibility().disableLoadingPhrases === true
              }
              debugMode={uiRuntime.app.getDebugMode()}
              layoutRuntime={buildLayoutRuntimeForTest(config, owner)}
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
    if (emulator !== undefined)
      await new Promise<void>((resolve) => {
        emulator.write('', resolve);
      });
    const buffer = emulator?.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < (buffer?.length ?? 0); index += 1) {
      lines.push(buffer?.getLine(index)?.translateToString(true) ?? '');
    }
    const delta = {
      terminalText: lines.join('\n'),
      text: stripAnsi(output),
      bytes: Buffer.byteLength(output),
      renderedKeys,
      mountedItems,
      staticOwners,
    };
    output = '';
    renderedKeys = [];
    return delta;
  }
  async function update(command: () => void | Promise<void>): Promise<Delta> {
    await act(async () => {
      await command();
    });
    await settle();
    return take();
  }
  try {
    await settle();
    await run({
      turn,
      pager,
      writer,
      session,
      append: async (item) => {
        await act(async () => {
          await writer.append({ type: 'ui-item' }, encodeJournalUiItem(item));
        });
        await waitFor(
          async () => {
            await act(async () => {
              await sleep(10);
            });
            expect(stripAnsi(output)).toContain(
              item.text.replaceAll('**', '').split(' ')[0].slice(0, 16),
            );
          },
          { interval: 1 },
        );
        await act(async () => {
          await sleep(0);
        });
        return take();
      },
      durableRows: async () => {
        const reader = await NativeJournalPageReader.open(filePath);
        try {
          return reader.rows;
        } finally {
          await reader.close();
        }
      },
      initial: await take(),
      update,
      resize: async (width, height): Promise<Delta> =>
        update(() => {
          process.stdout.columns = width;
          process.stdout.rows = height;
          emulator?.resize(width, height);
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
    emulator?.dispose();
    await pager.close();
    await session.close();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
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

describe('bounded production standard-buffer journal emission', () => {
  registerNativeCapScenarios(withLayout);
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

  it('keeps screen-reader output on the standard transcript path with alternate-buffer settings', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ initial, append, resize }) => {
        expect(initial.text).toContain('MSG_1_END');
        const delta = await append({
          type: 'gemini_content',
          text: 'ACCESSIBLE3434',
        });
        expect(count(delta.text, 'ACCESSIBLE3434')).toBe(1);
        expect(delta.text).not.toContain('MSG_2_END');
        expect((await resize(40, 4)).text).not.toContain('ACCESSIBLE3434');
      },
      false,
      true,
    );
  });

  it('keeps committed output visible when pending content overflows a short terminal', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, update, append, resize }) => {
        await update(() =>
          turn.commands.setPendingHistoryItems([
            {
              type: 'gemini_content',
              text: Array.from(
                { length: 12 },
                (_, index) =>
                  `Pending paragraph ${index} with several words to wrap.`,
              ).join('\n\n'),
            },
          ]),
        );
        await resize(40, 4);
        const delta = await append({
          type: 'gemini_content',
          text: 'VISIBLE3434',
        });
        expect(count(delta.text, 'VISIBLE3434')).toBe(1);
        expect(delta.terminalText).toContain('VISIBLE3434');
        expect(delta.text).not.toContain('MSG_1_END');
      },
    );
  });

  it('emits each append once after a two-row page without replaying history or header', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, initial, append, resize, durableRows, pager }) => {
        expect(count(initial.text, HEADER)).toBe(1);
        expect(count(initial.text, 'MSG_1_END')).toBe(1);
        for (const label of ['C3434', 'D3434', 'E3434']) {
          const delta = await append({
            type: 'gemini_content',
            text: `**${label}**`,
          });
          expect(count(delta.text, label)).toBe(1);
          expect(delta.text).not.toContain('MSG_1_END');
          expect(delta.text).not.toContain('MSG_2_END');
          expect(delta.text).not.toContain(HEADER);
          expect(pager.metrics().residentRows).toBeLessThanOrEqual(2);
        }
        expect(await durableRows()).toBe(5);
        const resized = await resize(30, 4);
        expect(resized.text).not.toContain('D3434');
        expect(resized.renderedKeys).toHaveLength(0);
        const delta = await append({
          type: 'gemini_content',
          text: 'NEW_WIDTH words follow the narrow terminal and wrap here.',
        });
        expect(delta.text).toContain('NEW_WIDTH words follow\n');
        expect(turn.store.getState().staticKey).toBe(0);
      },
      true,
    );
  });

  it('keeps disjoint durable batches ordered without replaying printed rows', async () => {
    await withLayout(
      [message(900), message(800)],
      2,
      async ({ writer, update, durableRows }) => {
        const batch = await update(async () => {
          await writer.append(
            { type: 'ui-item' },
            encodeJournalUiItem({
              type: 'gemini_content',
              text: 'BATCH_F3434',
            }),
          );
          await writer.append(
            { type: 'ui-item' },
            encodeJournalUiItem({
              type: 'gemini_content',
              text: 'BATCH_G3434',
            }),
          );
        });
        expect(count(batch.text, 'BATCH_F3434')).toBe(1);
        expect(count(batch.text, 'BATCH_G3434')).toBe(1);
        expect(batch.text.indexOf('BATCH_F3434')).toBeLessThan(
          batch.text.indexOf('BATCH_G3434'),
        );
        expect(batch.text).not.toContain('MSG_900_END');
        expect(batch.text).not.toContain('MSG_800_END');
        expect(await durableRows()).toBe(4);
      },
    );
  });

  it('retracts only the selected journal handle while later commits remain visible', async () => {
    await withLayout(
      [message(1)],
      2,
      async ({ writer, update, append, pager }) => {
        let handle:
          | Awaited<ReturnType<JournalDisplayWriter['append']>>
          | undefined;
        await update(async () => {
          handle = await writer.append(
            { type: 'ui-item' },
            encodeJournalUiItem({ type: 'warning', text: 'TRANSIENT3434' }),
          );
        });
        await update(async () => {
          if (handle === undefined)
            throw new Error('Missing durable display handle');
          await writer.retract(handle);
        });
        const delta = await append({
          type: 'gemini_content',
          text: 'AFTER_RETRACTION3434',
        });
        expect(count(delta.text, 'AFTER_RETRACTION3434')).toBe(1);
        expect(delta.text).not.toContain('TRANSIENT3434');
        expect(delta.text).not.toContain('MSG_1_END');
        await pager.invalidate();
        await pager.resumeFromJournal();
        expect(
          pager
            .getState()
            .rows.some(
              (row) => 'text' in row.item && row.item.text === 'TRANSIENT3434',
            ),
        ).toBe(false);
        expect(
          pager
            .getState()
            .rows.some(
              (row) =>
                'text' in row.item && row.item.text === 'AFTER_RETRACTION3434',
            ),
        ).toBe(true);
      },
    );
  });

  it('keeps clear and resume boundaries durable without replaying printed rows or colliding presentation IDs', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ session, writer, update, append, pager, durableRows }) => {
        const clear = await update(async () => {
          await session.store.commit([{ kind: 'clear' }]);
        });
        expect(clear.text).not.toContain('MSG_1_END');
        expect(clear.text).not.toContain('MSG_2_END');
        const replacement = await append({
          type: 'gemini_content',
          text: '**REPLACEMENT3434**',
        });
        expect(count(replacement.text, 'REPLACEMENT3434')).toBe(1);
        expect(replacement.text).not.toContain('earlier messages truncated');
        const resumed = await update(async () => {
          await pager.invalidate();
          await pager.resumeFromJournal();
        });
        expect(resumed.text).not.toContain('REPLACEMENT3434');
        expect(resumed.renderedKeys).toHaveLength(0);
        const sameId = await append({
          type: 'gemini_content',
          text: '**SAME_ID3434**',
        });
        expect(count(sameId.text, 'SAME_ID3434')).toBe(1);
        expect(sameId.text).not.toContain('REPLACEMENT3434');
        const batch = await update(async () => {
          for (const id of [7, 8, 9, 10])
            await writer.append(
              { type: 'ui-item' },
              encodeJournalUiItem(message(id)),
            );
        });
        for (const id of [7, 8, 9, 10])
          expect(count(batch.text, 'MSG_' + id + '_END')).toBe(1);
        expect(batch.text.indexOf('MSG_7_END')).toBeLessThan(
          batch.text.indexOf('MSG_10_END'),
        );
        expect(batch.text).not.toContain('SAME_ID3434');
        expect(await durableRows()).toBe(9);
        expect(pager.metrics().residentRows).toBeLessThanOrEqual(2);
      },
    );
  });

  it('preserves context-boundary membership across native clear and resume without replaying old output', async () => {
    await withLayout([], 10, async ({ session, update, pager }) => {
      const first = await update(async () => {
        await session.append([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'CONTEXT_OLD_USER3434' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'CONTEXT_OLD_AI3434' }],
          },
        ]);
      });
      expect(count(first.text, 'CONTEXT_OLD_USER3434')).toBe(1);
      expect(count(first.text, 'CONTEXT_OLD_AI3434')).toBe(1);
      const boundary = await update(async () => {
        await session.store.commit([{ kind: 'clear' }]);
        await session.append([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'CONTEXT_NEW3434' }],
          },
        ]);
        await pager.invalidate();
        await pager.resumeFromJournal();
      });
      expect(boundary.text).not.toContain('CONTEXT_OLD_USER3434');
      expect(boundary.text).not.toContain('CONTEXT_OLD_AI3434');
      expect(count(boundary.text, 'CONTEXT_NEW3434')).toBe(1);
      await pager.invalidate();
      await pager.resumeFromJournal();
      const rows = pager.getState().rows;
      expect(
        rows
          .filter(
            (row) =>
              typeof row.item.text === 'string' &&
              row.item.text.startsWith('CONTEXT_'),
          )
          .map((row) => row.contextState),
      ).toStrictEqual(['purged', 'purged', 'in-context']);
      const resumed = await update(async () => {
        await pager.invalidate();
        await pager.resumeFromJournal();
      });
      expect(resumed.text).not.toContain('CONTEXT_NEW3434');
      expect(resumed.renderedKeys).toHaveLength(0);
    });
  });

  it('replays the header and bounded durable page only on explicit refresh', async () => {
    await withLayout(
      [message(1), message(2)],
      2,
      async ({ turn, append, update, pager }) => {
        await append({ type: 'gemini_content', text: '**RETAINED3434**' });
        const unchanged = await update(() => {});
        expect(unchanged.renderedKeys).toHaveLength(0);
        expect(unchanged.text).not.toContain('RETAINED3434');
        const refreshed = await update(async () => {
          await pager.invalidate();
          await pager.resumeFromJournal();
          turn.commands.refreshStatic();
        });
        expect(count(refreshed.text, HEADER)).toBe(1);
        expect(count(refreshed.text, 'MSG_2_END')).toBe(1);
        expect(count(refreshed.text, 'RETAINED3434')).toBe(1);
        expect(refreshed.text).not.toContain('MSG_1_END');
        expect(refreshed.text).not.toContain('**RETAINED3434**');
      },
      true,
    );
  });

  it('emits the 399/400/401 boundary and every later durable entry without a retained ledger', async () => {
    await withLayout(
      Array.from({ length: 399 }, (_, id) => message(id)),
      400,
      async ({ initial, append, pager, durableRows }) => {
        expect(count(initial.text, 'MSG_398_END')).toBe(1);
        for (let n = 399; n < 440; n++) {
          const delta = await append({
            type: 'gemini_content',
            text: `SEQ_${n}_END`,
          });
          expect(count(delta.text, `SEQ_${n}_END`)).toBe(1);
          expect(delta.renderedKeys).toHaveLength(1);
          expect(delta.text).not.toContain('MSG_398_END');
          expect(pager.metrics().residentRows).toBeLessThanOrEqual(400);
        }
        expect(await durableRows()).toBe(440);
      },
    );
  }, 30000);

  it.each([false, true])(
    'pages a 4MiB UTF8 row without replaying it after an append, multibyte=%s',
    async (multibyte) => {
      const small = [message(1), message(2)];
      const large = sizedMessage(
        3,
        MAX_BYTES - serializedBytes(small),
        multibyte,
      );
      expect(serializedBytes([...small, large])).toBe(MAX_BYTES);
      await withLayout(
        [...small, large],
        400,
        async ({ append, pager, durableRows }) => {
          const delta = await append({
            type: 'gemini_content',
            text: 'MULTI_HEAD3434'.repeat(20),
          });
          expect(delta.text).toContain('MULTI_HEAD3434');
          expect(delta.text).not.toContain('MSG_1_END');
          expect(delta.renderedKeys).toHaveLength(1);
          expect(pager.metrics().residentBytes).toBeLessThanOrEqual(MAX_BYTES);
          expect(await durableRows()).toBe(4);
        },
      );
    },
    30000,
  );

  it.each([
    [25, false],
    [100, false],
    [400, false],
    [400, true],
  ] satisfies Array<[number, boolean]>)(
    'keeps renders and output delta-sized over 220 commits, page=%s near-byte-cap=%s',
    async (cap, nearBytes) => {
      const history = Array.from({ length: cap }, (_, id) => message(id));
      if (nearBytes)
        history[cap - 1] = sizedMessage(
          cap - 1,
          MAX_BYTES - 4096 - serializedBytes(history.slice(0, -1)),
          true,
        );
      await withLayout(
        history,
        cap,
        async ({ initial, append, pager, durableRows }) => {
          expect(initial.renderedKeys.length).toBeGreaterThanOrEqual(cap);
          expect(initial.staticOwners).toBe(1);
          const samples: number[] = [];
          let oldRenders = 0;
          const printed = new Set(initial.renderedKeys);
          for (let n = 0; n < 220; n++) {
            const label = `CHURN_${String(n).padStart(3, '0')}_END`;
            const delta = await append({ type: 'gemini_content', text: label });
            expect(count(delta.text, label)).toBe(1);
            oldRenders += delta.renderedKeys.filter((id) =>
              printed.has(id),
            ).length;
            for (const id of delta.renderedKeys) printed.add(id);
            expect(delta.mountedItems).toBe(0);
            expect(delta.staticOwners).toBe(1);
            expect(delta.renderedKeys).toHaveLength(1);
            expect(delta.text.match(/CHURN_\d{3}_END/g)).toStrictEqual([label]);
            expect(pager.metrics().residentRows).toBeLessThanOrEqual(cap);
            expect(pager.metrics().residentBytes).toBeLessThanOrEqual(
              MAX_BYTES,
            );
            samples.push(delta.bytes);
          }
          expect(oldRenders).toBe(0);
          expect(Math.max(...samples)).toBeLessThan(350);
          expect(await durableRows()).toBe(cap + 220);
          metrics.push({
            cap,
            nearBytes,
            commits: samples.length,
            oldRenders,
            maxBytes: Math.max(...samples),
          });
        },
        false,
        false,
        false,
      );
    },
    30000,
  );
});
