/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { act } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
void vi.mock('../components/Composer.js', () => ({ Composer: () => null }));
void vi.mock('../components/DialogManager.js', () => ({
  DialogManager: () => null,
}));
void vi.mock('../components/Footer.js', () => ({ Footer: () => null }));
void vi.mock('../components/AppHeader.js', () => ({ AppHeader: () => null }));
void vi.mock('../components/LoadingIndicator.js', () => ({
  LoadingIndicator: () => null,
}));
const { renderWithProviders, createMockSettings, waitFor } = await import(
  '../../__tests__/render.js'
);
const { createTestAgentClient } = await import(
  '@vybestack/llxprt-code-test-utils/core/config.js'
);
const { Config } = await import('@vybestack/llxprt-code-core');
const { DefaultAppLayout } = await import('./DefaultAppLayout.js');
const { JournalStandardTranscript } = await import(
  './journal-standard-transcript.js'
);
const { createUiSessionOwner } = await import(
  '../../__tests__/uiSessionOwner.js'
);
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
const { createScrollbackPagerStore } = await import(
  '../stores/turn/scrollbackPager.js'
);

async function writeJournal(filePath: string): Promise<void> {
  const session = await JournalSession.create(filePath);
  try {
    await session.append(
      Array.from({ length: 32 }, (_, seq) => ({
        speaker: 'human',
        blocks: [{ type: 'text', text: `disk-page-${seq}` }],
        metadata: { chronology: { seq, userTurn: 1, step: 1, recordedAt: 0 } },
      })),
    );
  } finally {
    await session.close();
  }
}

function makeUiRuntime(dir: string, alternate: boolean) {
  const config = new Config({
    sessionId: 'critical-pager',
    targetDir: dir,
    cwd: dir,
    debugMode: false,
    model: 'test',
  });
  const terminal = createTerminalStore();
  const turn = createTurnStore();
  const settings = createMockSettings({
    ui: {
      useAlternateBuffer: alternate,
      hideContextSummary: true,
      showTodoPanel: false,
    },
  });
  const owner = createUiSessionOwner(config);
  const base = buildUiRuntimeFromSource(config, owner);
  const uiRuntime = {
    ...base,
    agentClientSource: {
      getAgentClient: () =>
        createTestAgentClient({ hasChatInitialized: () => false }),
    },
  };
  return { config, owner, terminal, turn, settings, uiRuntime };
}

describe('layout disk-pager integration', () => {
  it.each([false, true])(
    'renders the bounded disk window and updates geometry, alternate=%s',
    async (alternate) => {
      const dir = await mkdtemp(join(tmpdir(), 'critical-layout-pager-'));
      const filePath = join(dir, 'session.llxj');
      await writeJournal(filePath);
      const viewport = {
        visibleKeys: [],
        viewportLines: 0,
        rowHeightLines: () => 1,
      };
      const store = createScrollbackPagerStore({
        filePath,
        viewport,
        pageRows: 4,
        settings: {
          marginViewports: 0,
          byteFloorBytes: 256,
          purgeDebounceMs: 0,
        },
      });
      const { config, owner, terminal, turn, settings, uiRuntime } =
        makeUiRuntime(dir, alternate);
      await store.resumeFromJournal();
      const view = renderWithProviders(
        <TerminalProvider store={terminal}>
          <TurnProvider store={turn}>
            <DefaultAppLayout
              uiRuntime={uiRuntime}
              slashCommandRuntime={buildSlashCommandRuntime(config, owner)}
              settings={settings}
              startupWarnings={[]}
              version="test"
              nightly={false}
              mainControlsRef={{ current: null }}
              rootUiRef={{ current: null }}
              pendingHistoryItemRef={{ current: null }}
              contextFileNames={[]}
              updateInfo={null}
              scrollbackPager={{ store, viewport }}
            />
          </TurnProvider>
        </TerminalProvider>,
        { settings },
      );
      const frame = (): string =>
        alternate
          ? (view.lastFrame() ?? '')
          : view.frames.join(String.fromCharCode(10));
      try {
        await waitFor(() => expect(frame()).toContain('disk-page-31'));
        expect(frame()).not.toContain('ordinary-array-sentinel');
        expect(store.metrics().residentRows).toBeLessThanOrEqual(4);
        await act(async () => {
          terminal.commands.setDimensions({
            terminalWidth: 70,
            terminalHeight: 16,
            inputWidth: 60,
            suggestionsWidth: 50,
          });
        });
        await waitFor(() =>
          expect(viewport.viewportLines).toBe(
            Math.max(1, terminal.store.getState().availableTerminalHeight),
          ),
        );
        expect(frame()).toContain('disk-page-31');
        expect(frame()).not.toContain('disk-page-0');
      } finally {
        view.unmount();
        await store.close();
        await config.dispose();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('standard transcript residency', () => {
  it('releases emitted batches while retaining new output until it is printed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'standard-output-residency-'));
    const filePath = join(dir, 'session.llxj');
    const session = await JournalSession.create(filePath);
    const viewport = {
      visibleKeys: [],
      viewportLines: 8,
      rowHeightLines: () => 1,
    };
    const store = createScrollbackPagerStore({
      filePath,
      viewport,
      pageRows: 16,
      settings: {
        marginViewports: 0,
        byteFloorBytes: 256,
        purgeDebounceMs: 0,
      },
    });
    const { config, owner, terminal, turn, settings } = makeUiRuntime(
      dir,
      false,
    );
    await store.resumeFromJournal();
    const view = renderWithProviders(
      <TerminalProvider store={terminal}>
        <TurnProvider store={turn}>
          <JournalStandardTranscript
            store={store}
            config={buildSlashCommandRuntime(config, owner)}
            viewport={viewport}
          />
        </TurnProvider>
      </TerminalProvider>,
      { settings },
    );
    try {
      for (let batch = 0; batch < 8; batch++) {
        await act(async () => {
          await session.append(
            Array.from({ length: 16 }, (_, index) => ({
              speaker: 'human',
              blocks: [{ type: 'text', text: `batch-${batch}-${index}` }],
            })),
          );
        });
        await waitFor(() =>
          expect(view.frames.join('\n')).toContain(`batch-${batch}-15`),
        );
        await waitFor(() =>
          expect(store.metrics().residentRows).toBeLessThanOrEqual(16),
        );
      }
      expect(view.frames.join('\n')).toContain('batch-0-0');
    } finally {
      view.unmount();
      await store.close();
      await session.close();
      await config.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
