import { useOwnerSessionAgents } from './__tests__/owner-session-agents.js';
import { bindOwnerBrowserCatalog } from './browserCatalogHost.js';
import { describe, expect, it, vi } from 'bun:test';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { act, useEffect } from 'react';
import { readFile, readdir } from 'node:fs/promises';
import { renderHook } from '../../__tests__/render.js';
import { createDeferred } from '../../__tests__/async.js';
import { resumeOwnerSession } from '../utils/resumeOwnerSession.js';
import {
  type UseSessionBrowserProps,
  type UseSessionBrowserResult,
  useSessionBrowser,
} from './useSessionBrowser.js';
import { Key } from './useKeypress.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

function renderBrowser(props: UseSessionBrowserProps): ReturnType<
  typeof renderHook<UseSessionBrowserResult>
> & {
  until(predicate: (state: UseSessionBrowserResult) => boolean): Promise<void>;
} {
  const listeners = new Set<() => void>();
  const browser = renderHook(() => {
    const state = useSessionBrowser(props);
    useEffect(() => {
      for (const notify of listeners) notify();
    }, [state]);
    return state;
  });
  return {
    ...browser,
    until(
      predicate: (state: UseSessionBrowserResult) => boolean,
    ): Promise<void> {
      return new Promise((resolve) => {
        const notify = (): void => {
          if (predicate(browser.result.current)) {
            listeners.delete(notify);
            resolve();
          }
        };
        listeners.add(notify);
        notify();
      });
    },
  };
}

describe('owner session browser', () => {
  const openAgent = useOwnerSessionAgents();
  it('waits for catalog I/O to complete when the polling clock has already elapsed', async () => {
    const { agent, config } = await openAgent();
    await agent.setHistory([human('pending browser source')]);
    await agent.session.setRecording({ enabled: true });
    const sourceId = (await agent.session.listSessions()).at(0)?.id;
    if (!sourceId) throw new Error('Missing source session');
    await agent.session.setRecording({ enabled: false });
    const gate = createDeferred<void>();
    const requested = createDeferred<void>();
    const browser = renderBrowser({
      chatsDir: config.projectChatsDir,
      projectHash: config.projectTempDir.split('/').at(-1) ?? '',
      currentSessionId: 'another-owner',
      readCatalog: async () => {
        requested.resolve();
        await gate.promise;
        return {
          ...(await agent.session.listBrowserTargetsDetailed()),
          skippedCount: 0,
          currentSessionId: 'another-owner',
        };
      },
      deleteTarget: async () => {},
      onSelect: async () => ({ ok: true }),
      onClose: () => {},
    });
    try {
      await requested.promise;
      vi.useFakeTimers();
      const loaded = browser.until((state) => !state.isLoading);
      await advanceTimersByTimeAsync(1001);
      expect(browser.result.current.isLoading).toBe(true);
      vi.useRealTimers();
      gate.resolve();
      await loaded;
      expect(browser.result.current.error).toBeNull();
      expect(
        browser.result.current.sessions.some(
          (row) => row.sessionId === sourceId,
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
      gate.resolve();
      browser.unmount();
    }
  }, 30000);
  it('lists and deletes a closed source through the Agent without affecting the live owner', async () => {
    const { agent } = await openAgent();
    await agent.setHistory([human('browser deletion source')]);
    await agent.session.setRecording({ enabled: true });
    const sourceId = (await agent.session.listSessions()).at(0)?.id;
    if (!sourceId) throw new Error('Missing source session');
    await agent.session.setRecording({ enabled: false });
    const { agent: next, config } = await openAgent();
    const chatsDir = config.projectChatsDir;
    await next.setHistory([human('live owner stays')]);
    await next.session.setRecording({ enabled: true });
    const path = next.session.getRecording().path;
    if (!path) throw new Error('Missing live owner');
    const catalog: Pick<
      UseSessionBrowserProps,
      'readCatalog' | 'deleteTarget'
    > = {
      readCatalog: bindOwnerBrowserCatalog(
        () => next.session.listBrowserTargetsDetailed(),
        () => next.session.getRecording().path,
        () => config.getSessionId(),
      ),
      deleteTarget: async (target) => {
        if (target.kind === 'checkpoint')
          await next.session.deleteCheckpoint(target.checkpointId);
        else await next.session.deleteSession(target.session.sessionId);
      },
    };
    const browser = renderBrowser({
      chatsDir,
      projectHash: config.projectTempDir.split('/').at(-1) ?? '',
      currentSessionId: config.getSessionId(),
      ...catalog,
      onSelect: async (target) => {
        await resumeOwnerSession(
          next.session.resume.bind(next.session),
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
          'allowed',
          next.session.listBrowserTargetsDetailed.bind(next.session),
        );
        return { ok: true };
      },
      onClose: () => {},
    });
    await browser.until((state) => !state.isLoading);
    expect(browser.result.current.error).toBeNull();
    expect(
      browser.result.current.sessions.some((row) => row.sessionId === sourceId),
    ).toBe(true);
    act(() => {
      browser.result.current.handleKeypress('Tab', key('tab'));
      browser.result.current.handleKeypress('Delete', key('delete'));
      browser.result.current.handleKeypress('y', key('y'));
    });
    await browser.until(
      (state) => !state.isLoading && state.deleteConfirmIndex === null,
    );
    expect(browser.result.current.error).toBeNull();
    expect(
      browser.result.current.sessions.some((row) => row.sessionId === sourceId),
    ).toBe(false);
    expect(await readFile(path, 'utf8')).toContain('live owner stays');
    expect(
      (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(1);
    browser.unmount();
  }, 30000);
  it('selects a real owner session and replays it without a raw recording swap', async () => {
    const { agent } = await openAgent();
    await agent.setHistory([human('browser resume source')]);
    await agent.session.setRecording({ enabled: true });
    const sourceId = (await agent.session.listSessions()).at(0)?.id;
    if (!sourceId) throw new Error('Missing source session');
    await agent.session.setRecording({ enabled: false });
    const { agent: next, config } = await openAgent();
    const chatsDir = config.projectChatsDir;
    await next.setHistory([human('prior owner')]);
    await next.session.setRecording({ enabled: true });
    let shown = false;
    const catalog: Pick<
      UseSessionBrowserProps,
      'readCatalog' | 'deleteTarget'
    > = {
      readCatalog: bindOwnerBrowserCatalog(
        () => next.session.listBrowserTargetsDetailed(),
        () => next.session.getRecording().path,
        () => config.getSessionId(),
      ),
      deleteTarget: async (target) => {
        if (target.kind === 'checkpoint')
          await next.session.deleteCheckpoint(target.checkpointId);
        else await next.session.deleteSession(target.session.sessionId);
      },
    };
    const browser = renderBrowser({
      chatsDir,
      projectHash: config.projectTempDir.split('/').at(-1) ?? '',
      currentSessionId: config.getSessionId(),
      ...catalog,
      onSelect: async (target) => {
        const replay = await resumeOwnerSession(
          next.session.resume.bind(next.session),
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
          'allowed',
          next.session.listBrowserTargetsDetailed.bind(next.session),
        );
        shown = replay.uiHistory.some(
          (item) =>
            item.type === 'user' && item.text === 'browser resume source',
        );
        return { ok: true };
      },
      onClose: () => {},
    });
    await browser.until((state) => !state.isLoading);
    expect(browser.result.current.error).toBeNull();
    expect(
      browser.result.current.sessions.some((row) => row.sessionId === sourceId),
    ).toBe(true);
    act(() => browser.result.current.handleKeypress('', key('return')));
    await browser.until((state) => !state.isResuming);
    expect(browser.result.current.error).toBeNull();
    expect(shown).toBe(true);
    expect(
      (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(1);
    browser.unmount();
  }, 30000);
});
