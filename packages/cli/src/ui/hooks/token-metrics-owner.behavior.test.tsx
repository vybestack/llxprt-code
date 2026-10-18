/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useMemo, useState } from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { bindHistoryTokenSubscription } from '../containers/AppContainer/hooks/historyTokenSubscriptions.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { buildUiRuntimeFromSource } from '../cliUiRuntime.js';
import { RuntimeContextProvider } from '../../__tests__/runtime-context-fixture.js';
import { useTokenMetricsTracking } from '../containers/AppContainer/hooks/useTokenMetricsTracking.js';

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
    await owner.agentClient.startChat(await owner.agentClient.getHistory());
    await peer.agentClient.startChat(await peer.agentClient.getHistory());
    const ownedHistory = owner.agentClient.getHistoryService();
    const peerHistory = peer.agentClient.getHistoryService();
    if (!ownedHistory || !peerHistory)
      throw new Error('Missing initialized token history');
    await ownedHistory.waitForTokenUpdates();
    await peerHistory.waitForTokenUpdates();
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
          () =>
            bindHistoryTokenSubscription(
              () => active.agentClient.getHistoryService(),
              new DebugLogger('llxprt:ui:tokentracking'),
            ),
          [active],
        );
        useTokenMetricsTracking(
          Object.assign(
            {
              uiRuntime,
              metrics: active.metrics,
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
      await waitFor(() =>
        expect(hook.result.current).toBe(ownedHistory.getTotalTokens()),
      );
      await owner.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'more owned history '.repeat(30) }],
      });
      await ownedHistory.waitForTokenUpdates();
      await waitFor(() =>
        expect(hook.result.current).toBe(ownedHistory.getTotalTokens()),
      );
      hook.rerender({ active: peer });
      await waitFor(() =>
        expect(hook.result.current).toBe(peerHistory.getTotalTokens()),
      );
      await owner.dispose();
      await peer.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'surviving peer history '.repeat(30) }],
      });
      await peerHistory.waitForTokenUpdates();
      await waitFor(() =>
        expect(hook.result.current).toBe(peerHistory.getTotalTokens()),
      );
    } finally {
      hook.unmount();
      await config.dispose();
    }
  });
});
