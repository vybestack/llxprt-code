/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { act } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
  await writeFile(
    filePath,
    Array.from({ length: 32 }, (_, i) =>
      JSON.stringify({
        v: 1,
        seq: i,
        ts: '2026-10-05T00:00:00.000Z',
        type: 'content',
        payload: {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: `disk-page-${i}` }],
            metadata: {
              chronology: { seq: i, userTurn: 1, step: 1, recordedAt: 0 },
            },
          },
        },
      }),
    ).join('\n') + '\n',
  );
}

function makeUiRuntime(dir: string) {
  const config = new Config({
    sessionId: 'critical-pager',
    targetDir: dir,
    cwd: dir,
    debugMode: false,
    model: 'test',
  });
  const terminal = createTerminalStore();
  const turn = createTurnStore({
    history: [{ id: 1, type: 'user', text: 'ordinary-array-sentinel' }],
  });
  const settings = createMockSettings({
    ui: {
      useAlternateBuffer: true,
      hideContextSummary: true,
      showTodoPanel: false,
    },
  });
  const base = buildUiRuntimeFromSource(config);
  const uiRuntime = {
    ...base,
    agentClientSource: {
      getAgentClient: () =>
        createTestAgentClient({ hasChatInitialized: () => false }),
    },
  };
  return { config, terminal, turn, settings, uiRuntime };
}

describe('layout disk-pager integration', () => {
  it('renders the bounded disk window instead of resident transcript arrays and updates its geometry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'critical-layout-pager-'));
    const filePath = join(dir, 'session.jsonl');
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
      settings: { marginViewports: 0, byteFloorBytes: 256, purgeDebounceMs: 0 },
    });
    const { config, terminal, turn, settings, uiRuntime } = makeUiRuntime(dir);
    await store.resumeFromJournal();
    const view = renderWithProviders(
      <TerminalProvider store={terminal}>
        <TurnProvider store={turn}>
          <DefaultAppLayout
            uiRuntime={uiRuntime}
            slashCommandRuntime={buildSlashCommandRuntime(config)}
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
    try {
      await waitFor(() => expect(view.lastFrame()).toContain('disk-page-31'));
      expect(view.lastFrame()).not.toContain('ordinary-array-sentinel');
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
      expect(view.lastFrame()).toContain('disk-page-31');
      expect(view.lastFrame()).not.toContain('disk-page-0');
    } finally {
      view.unmount();
      await store.close();
      await config.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
