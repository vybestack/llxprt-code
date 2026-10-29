/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { captureSessionOwner } from '../../../../../../agents/src/api/__tests__/helpers/capture-session-owner.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildFactoryLessConfig } from '../../../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { renderHook } from '../../../../__tests__/render.js';
import { useTokenMetricsTracking } from './useTokenMetricsTracking.js';

describe('token metrics shutdown', () => {
  it('stops live tracking before agent disposal while the quit screen stays mounted', async () => {
    const built = await buildFactoryLessConfig('plain-text.jsonl');
    const { value: agent, owner } = await captureSessionOwner(() =>
      fromConfig(
        built.config,
        built.settingsService,
        {
          activation: {
            provider: built.config.getProvider(),
            model: built.config.getModel(),
          },
        },
        new CredentialAuthority(),
      ),
    );
    const client = owner.clients.getAgentClient();
    const published: number[] = [];
    await client.startChat([]);
    const history = client.getHistoryService();
    if (!history) throw new Error('Missing initialized history service');
    vi.useFakeTimers();
    const view = renderHook(() =>
      useTokenMetricsTracking({
        subscribeHistoryTokens: agent.session.subscribeHistoryTokens.bind(
          agent.session,
        ),
        subscribeRecordingHistory: () =>
          agent.session.connectRecordingHistory(() => null),
        readProviderMetrics: agent.providerReads.getActiveProviderMetrics.bind(
          agent.providerReads,
        ),
        readSessionTokenUsage: agent.providerReads.getSessionTokenUsage.bind(
          agent.providerReads,
        ),
        setTokenTrackingMetrics: agent.metrics.setTokenTrackingMetrics.bind(
          agent.metrics,
        ),
        updateHistoryTokenCount: (value) => published.push(value),
      }),
    );
    try {
      await act(() => vi.advanceTimersByTime(100));
      expect(published.length).toBeGreaterThan(0);
      expect(history.listenerCount('tokensUpdated')).toBe(1);
      view.result.current.stopTracking();
      expect(history.listenerCount('tokensUpdated')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      const finalCount = published.length;
      await agent.dispose();
      await act(async () => {
        view.rerender();
        vi.advanceTimersByTime(2100);
        await Promise.resolve();
      });
      expect(published).toHaveLength(finalCount);
    } finally {
      view.unmount();
      vi.useRealTimers();
      await agent.dispose();
      await built.cleanup();
    }
  });
});
