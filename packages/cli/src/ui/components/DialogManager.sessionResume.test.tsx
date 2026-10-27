/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, createMockSettings } from '../../__tests__/render.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { readJournalItems } from '../stores/turn/journal-turn-test-helpers.js';
import { useSessionBrowserHandler } from './DialogManager.js';

describe('session browser journal resume', () => {
  it('keeps the skipped-recording warning alongside the restored transcript', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, chatsDir, config }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'restored conversation' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const id = agent.session.getSessionId();
        await agent.session.setRecording({ enabled: false });
        const corruptPath = join(
          chatsDir,
          'session-2026-10-08T21-18-08-corrupt.llxj',
        );
        await writeFile(corruptPath, 'LLXJRNL\0');
        const next = await borrow();
        const turn = createTurnStore();
        turn.commands.bindJournal(() => next.agentClient.getHistoryService());
        const target = (await next.session.listBrowserTargets()).find(
          (entry) => entry.kind === 'session' && entry.session.sessionId === id,
        );
        if (!target) throw new Error('Missing source session');
        let closed = false;
        const view = renderHook(() =>
          useSessionBrowserHandler(
            composeFixtureRuntime(config),
            {
              recordingOwner: 'agent',
              ui: {
                clear: turn.commands.clearItems,
                addItem: turn.commands.addItem,
                pendingItem: null,
              },
              services: { agent: next, settings: createMockSettings({}) },
            },
            turn.commands.addItem,
            () => {
              closed = true;
            },
          ),
        );
        try {
          expect(await view.result.current(target)).toStrictEqual({ ok: true });
          const visible = (await readJournalItems(next)).map(
            (item) => item.text,
          );
          expect(visible[0]).toBe('restored conversation');
          expect(visible.at(-1)).toContain(corruptPath);
          expect(visible.at(-1)).toContain(
            'Skipped unreadable session recording',
          );
          expect(closed).toBe(true);
        } finally {
          view.unmount();
        }
      },
    );
  });
});
