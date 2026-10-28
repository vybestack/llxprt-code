/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act, createElement, type ReactNode } from 'react';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildFactoryLessConfig } from '../../../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { renderHook } from '../../../../__tests__/render.js';
import { createRuntimeOwnerFeatures } from '../../../../runtime/createRuntimeOwnerFeatures.js';
import { createSessionModelCommand } from '../../../../runtime/session-model-command.js';
import { buildUiRuntimeFromSource } from '../../../cliUiRuntime.js';
import { RuntimeContextProvider } from '../../../contexts/RuntimeContext.js';
import { useTokenMetricsTracking } from './useTokenMetricsTracking.js';

describe('token metrics shutdown', () => {
  it('stops live tracking before agent disposal while the quit screen stays mounted', async () => {
    const built = await buildFactoryLessConfig('plain-text.jsonl');
    const agent = await fromConfig({
      config: built.config,
      settingsService: built.settingsService,
      settingsOwner: built.settingsOwner,
    });
    const owner = createRuntimeOwnerFeatures(
      built.config,
      agent.providerManager,
      () => [process.cwd()],
      createSessionModelCommand(agent),
      built.settingsOwner,
      built.settingsService,
      agent.workspace,
    );
    const runtime = buildUiRuntimeFromSource(built.config, agent);
    const published: number[] = [];
    await agent.agentClient.startChat();
    const history = agent.agentClient.getHistoryService();
    if (!history) throw new Error('Missing initialized history service');
    vi.useFakeTimers();
    const view = renderHook(
      () =>
        useTokenMetricsTracking({
          uiRuntime: runtime,
          recordingOwner: 'agent',
          updateHistoryTokenCount: (value) => published.push(value),
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(RuntimeContextProvider, { agent, owner }, children),
      },
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
