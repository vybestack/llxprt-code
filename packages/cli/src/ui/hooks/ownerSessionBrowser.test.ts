/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { resumeOwnerSession } from '../utils/ownerSessionUi.js';
import { useSessionBrowser } from './useSessionBrowser.js';
import type { Key } from './useKeypress.js';

function key(name: string): Key {
  return {
    name,
    sequence: name,
    ctrl: false,
    shift: false,
    meta: false,
  };
}

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});

describe('owner session browser', () => {
  it('lists and deletes a closed source through the Agent without affecting the live owner', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, chatsDir, config }) => {
        await agent.setHistory([human('browser deletion source')]);
        await agent.session.setRecording({ enabled: true });
        const sourceId = (await agent.session.listSessions()).at(0)?.id;
        if (!sourceId) throw new Error('Missing source session');
        await agent.session.setRecording({ enabled: false });
        const next = await borrow();
        await next.setHistory([human('live owner stays')]);
        await next.session.setRecording({ enabled: true });
        const path = next.session.getRecording().path;
        if (!path) throw new Error('Missing live owner');
        const browser = renderHook(() =>
          useSessionBrowser({
            chatsDir,
            projectHash: config.projectTempDir.split('/').at(-1) ?? '',
            currentSessionId: config.getSessionId(),
            ownerAgent: next,
            onSelect: async (target) => {
              await resumeOwnerSession(
                next,
                target.kind === 'session'
                  ? target.session.sessionId
                  : target.checkpointId,
                'allowed',
              );
              return { ok: true };
            },
            onClose: () => {},
          }),
        );
        await waitFor(() =>
          expect(
            browser.result.current.sessions.some(
              (row) => row.sessionId === sourceId,
            ),
          ).toBe(true),
        );
        browser.result.current.handleKeypress('Tab', key('tab'));
        browser.result.current.handleKeypress('Delete', key('delete'));
        browser.result.current.handleKeypress('y', key('y'));
        await waitFor(() =>
          expect(
            browser.result.current.sessions.some(
              (row) => row.sessionId === sourceId,
            ),
          ).toBe(false),
        );
        expect(await readFile(path, 'utf8')).toContain('live owner stays');
        expect(
          (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toHaveLength(1);
        browser.unmount();
      },
    );
  }, 30000);
  it('selects a real owner session and replays it without a raw recording swap', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, chatsDir, config }) => {
        await agent.setHistory([human('browser resume source')]);
        await agent.session.setRecording({ enabled: true });
        const sourceId = (await agent.session.listSessions()).at(0)?.id;
        if (!sourceId) throw new Error('Missing source session');
        await agent.session.setRecording({ enabled: false });
        const next = await borrow();
        await next.setHistory([human('prior owner')]);
        await next.session.setRecording({ enabled: true });
        let shown = false;
        const browser = renderHook(() =>
          useSessionBrowser({
            chatsDir,
            projectHash: config.projectTempDir.split('/').at(-1) ?? '',
            currentSessionId: config.getSessionId(),
            ownerAgent: next,
            onSelect: async (target) => {
              const replay = await resumeOwnerSession(
                next,
                target.kind === 'session'
                  ? target.session.sessionId
                  : target.checkpointId,
                'allowed',
              );
              shown = replay.uiHistory.some(
                (item) =>
                  item.type === 'user' && item.text === 'browser resume source',
              );
              return { ok: true };
            },
            onClose: () => {},
          }),
        );
        await waitFor(() =>
          expect(
            browser.result.current.sessions.some(
              (row) => row.sessionId === sourceId,
            ),
          ).toBe(true),
        );
        browser.result.current.handleKeypress('', key('return'));
        await waitFor(() => expect(shown).toBe(true));
        expect(
          (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toHaveLength(1);
        browser.unmount();
      },
    );
  }, 30000);
});
