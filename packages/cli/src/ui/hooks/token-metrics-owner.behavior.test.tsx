/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useMemo, useState } from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { buildUiRuntimeFromSource } from '../../__tests__/ui-runtime-composition-fixture.js';
import { RuntimeContextProvider } from '../../__tests__/runtime-context-fixture.js';
import { useTokenMetricsTracking } from '../containers/AppContainer/hooks/useTokenMetricsTracking.js';

function observeHistoryTokens(agent: Agent): () => number {
  let latest = 0;
  agent.session.subscribeHistoryTokens((count) => {
    latest = count;
  });
  return () => latest;
}

describe('token metrics captured history ownership', () => {
  const makeOwner = useCommandOwners();
  it('subscribes to captured history and replaces the mounted owner before retiring it', async () => {
    const owner = await makeOwner('token-history-owner');
    const peer = await makeOwner('token-history-peer');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'owner text '.repeat(60) }],
      },
    ]);
    await peer.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'peer' }] },
    ]);
    await owner.session.replaceHistory(await owner.session.getHistory());
    await peer.session.replaceHistory(await peer.session.getHistory());
    const ownedTokens = observeHistoryTokens(owner);
    const peerTokens = observeHistoryTokens(peer);
    await waitFor(() => expect(ownedTokens()).toBeGreaterThan(0));
    await waitFor(() => expect(peerTokens()).toBeGreaterThan(0));
    const config = new Config({
      sessionId: 'token-host',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      debugMode: false,
      model: 'fake-model',
    });
    const uiRuntime = buildUiRuntimeFromSource(config, peer);
    const context = createMockCommandContext();
    const hook = renderHook(
      ({ active }) => {
        const [count, setCount] = useState(-1);
        const subscribeHistoryTokens = useMemo(
          () => active.session.subscribeHistoryTokens.bind(active.session),
          [active],
        );
        useTokenMetricsTracking(
          Object.assign(
            {
              uiRuntime,
              setTokenTrackingMetrics: useMemo(
                () =>
                  active.metrics.setTokenTrackingMetrics.bind(active.metrics),
                [active],
              ),
              updateHistoryTokenCount: setCount,
            },
            {
              subscribeHistoryTokens,
              subscribeRecordingHistory: () => () => {},
              readProviderMetrics: context.runtimeApi.getActiveProviderMetrics,
              readSessionTokenUsage: context.runtimeApi.getSessionTokenUsage,
            },
          ),
        );
        return count;
      },
      {
        initialProps: { active: owner },
        wrapper: ({ children }) => (
          <RuntimeContextProvider
            agent={peer}
            owner={context.runtimeApi}
            requestFetch={context.runtimeApi.fetch}
          >
            {children}
          </RuntimeContextProvider>
        ),
      },
    );
    try {
      await waitFor(() => expect(hook.result.current).toBe(ownedTokens()));
      const ownedBefore = ownedTokens();
      await owner.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'more owned history '.repeat(30) }],
      });
      await waitFor(() => expect(ownedTokens()).toBeGreaterThan(ownedBefore));
      await waitFor(() => expect(hook.result.current).toBe(ownedTokens()));
      hook.rerender({ active: peer });
      await waitFor(() => expect(hook.result.current).toBe(peerTokens()));
      await owner.dispose();
      const peerBefore = peerTokens();
      await peer.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'surviving peer history '.repeat(30) }],
      });
      await waitFor(() => expect(peerTokens()).toBeGreaterThan(peerBefore));
      await waitFor(() => expect(hook.result.current).toBe(peerTokens()));
    } finally {
      hook.unmount();
      await config.dispose();
    }
  });
});
