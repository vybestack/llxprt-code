/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  ApiResponseEvent,
  ToolCallEvent,
  logApiResponse,
  logToolCall,
  type RootTelemetry,
} from '@vybestack/llxprt-code-telemetry';
import { drain } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import type { Agent } from '../agent.js';

interface MetricsAgent {
  readonly agent: Agent;
  readonly config: Config;
  readonly telemetry: RootTelemetry;
  readonly cleanup: () => Promise<void>;
}

async function openMetricsAgent(): Promise<MetricsAgent> {
  const route = await openRouteBPreflight({
    config: { sessionId: 'same-label' },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  const cleanup = (): Promise<void> =>
    runCleanupSteps([
      () => route.disposePreflight(),
      () => route.close(),
      () => settingsOwner.dispose(),
    ]);
  try {
    await route.prepare({ settingsOwner });
    const agent = await route.createAgent();
    return {
      agent,
      config: route.config,
      telemetry: settingsOwner.telemetry,
      cleanup: async () => {
        await agent.dispose();
        await cleanup();
      },
    };
  } catch (primary) {
    return cleanupAfterFailure(primary, cleanup);
  }
}

function response(
  metrics: MetricsAgent,
  promptId: string,
  input: number,
  output: number,
): void {
  const event = new ApiResponseEvent('same-model', 100, promptId, {
    inputTokenCount: input,
    outputTokenCount: output,
    totalTokenCount: input + output,
  });
  event.provider_owned = true;
  logApiResponse(metrics.config, event, metrics.telemetry);
}

function tool(metrics: MetricsAgent): void {
  const event = new ToolCallEvent({
    status: 'success',
    durationMs: 25,
    request: {
      name: 'same-tool',
      args: {},
      callId: 'same-call',
      prompt_id: 'same-prompt',
      agentId: 'same-label',
      isClientInitiated: false,
    },
    response: { callId: 'same-call' },
  });
  logToolCall(metrics.config, event, metrics.telemetry);
}

function counters(agent: Agent) {
  const stats = agent.getStats();
  return {
    promptTokens: stats.promptTokens,
    candidateTokens: stats.candidateTokens,
    apiRequests: stats.apiRequests,
    toolCalls: stats.toolCalls,
    contextWindowUsed: stats.contextWindowUsed,
  };
}

describe('concurrently live equal-label agent metrics', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');

  it('isolates interleaved turns, equal attempt/tool IDs, subscriptions and session clearing', async () => {
    const a = await openMetricsAgent();
    const b = await openMetricsAgent();
    try {
      const bUpdates: number[] = [];
      const unsubscribe = b.agent.onStats((stats) => {
        bUpdates.push(stats.apiRequests);
      });
      const initialB = {
        promptTokens: 0,
        candidateTokens: 0,
        apiRequests: 0,
        toolCalls: 0,
        contextWindowUsed: 0,
      };
      await drain(a.agent.stream('hello A'));
      expect(counters(b.agent)).toStrictEqual(initialB);
      expect(bUpdates).toStrictEqual([0]);
      const aTurn = counters(a.agent);
      response(a, 'same-attempt', 40, 10);
      tool(a);
      expect(counters(b.agent)).toStrictEqual(initialB);
      await drain(b.agent.stream('hello B'));
      const bTurn = counters(b.agent);
      response(b, 'same-attempt', 70, 20);
      tool(b);
      expect(a.agent.getStats()).toMatchObject({
        promptTokens: aTurn.promptTokens + 40,
        candidateTokens: aTurn.candidateTokens + 10,
        apiRequests: aTurn.apiRequests + 1,
        toolCalls: aTurn.toolCalls + 1,
      });
      expect(b.agent.getStats()).toMatchObject({
        promptTokens: bTurn.promptTokens + 70,
        candidateTokens: bTurn.candidateTokens + 20,
        apiRequests: bTurn.apiRequests + 1,
        toolCalls: bTurn.toolCalls + 1,
      });
      const beforeClearB = {
        promptTokens: bTurn.promptTokens + 70,
        candidateTokens: bTurn.candidateTokens + 20,
        apiRequests: bTurn.apiRequests + 1,
        toolCalls: bTurn.toolCalls + 1,
        contextWindowUsed: bTurn.contextWindowUsed,
      };
      const framesBeforeClear = bUpdates.length;
      a.agent.metrics.reset();
      expect(a.agent.getStats()).toMatchObject({
        promptTokens: 0,
        apiRequests: 0,
        toolCalls: 0,
      });
      expect(counters(b.agent)).toStrictEqual(beforeClearB);
      response(a, 'new-attempt', 15, 5);
      await a.agent.session.startNewSession();
      expect(a.agent.getStats()).toMatchObject({
        promptTokens: 0,
        apiRequests: 0,
        toolCalls: 0,
        contextWindowUsed: 0,
      });
      expect(counters(b.agent)).toStrictEqual(beforeClearB);
      expect(bUpdates).toHaveLength(framesBeforeClear);
      unsubscribe();
      response(b, 'after-unsubscribe', 5, 3);
      expect(bUpdates).toHaveLength(framesBeforeClear);
    } finally {
      await b.cleanup();
      await a.cleanup();
    }
  });

  it('retires A metrics subscriptions while B continues producing stats', async () => {
    const a = await openMetricsAgent();
    const b = await openMetricsAgent();
    try {
      response(a, 'attempt-a', 40, 10);
      response(b, 'attempt-b', 70, 20);
      const before = {
        promptTokens: 70,
        candidateTokens: 20,
        apiRequests: 1,
        toolCalls: 0,
        contextWindowUsed: 0,
      };
      const aFrames: number[] = [];
      a.agent.onStats((stats) => {
        aFrames.push(stats.apiRequests);
      });
      await a.agent.dispose();
      expect(counters(b.agent)).toStrictEqual(before);
      await drain(b.agent.stream('still working'));
      const afterTurn = counters(b.agent);
      response(b, 'attempt-b2', 5, 3);
      expect(b.agent.getStats()).toMatchObject({
        promptTokens: afterTurn.promptTokens + 5,
        candidateTokens: afterTurn.candidateTokens + 3,
        apiRequests: afterTurn.apiRequests + 1,
      });
      expect(aFrames).toStrictEqual([1]);
    } finally {
      await b.cleanup();
      await a.cleanup();
    }
  });

  it('closes the telemetry root of a disposed settings owner while a peer owner stays open', async () => {
    const first = await openRouteBPreflight();
    const peer = await openRouteBPreflight();
    const firstOwner = new SessionSettingsOwner(first.settings);
    const peerOwner = new SessionSettingsOwner(peer.settings);
    try {
      const firstRoot = firstOwner.bindTelemetry(first.config);
      const peerRoot = peerOwner.bindTelemetry(peer.config);
      expect(() => firstRoot.localMetrics.reset()).not.toThrow();
      await firstOwner.dispose();
      expect(() => firstRoot.localMetrics.reset()).toThrow(
        'Session metrics are closed',
      );
      expect(() => firstRoot.localMetrics.setLastPromptTokenCount(1)).toThrow(
        'Session metrics are closed',
      );
      expect(() => peerRoot.localMetrics.reset()).not.toThrow();
      expect(() =>
        peerRoot.localMetrics.setLastPromptTokenCount(7),
      ).not.toThrow();
      expect(peerRoot.localMetrics.getLastPromptTokenCount()).toBe(7);
    } finally {
      await runCleanupSteps([
        () => peerOwner.dispose(),
        () => firstOwner.dispose(),
        () => peer.close(),
        () => first.close(),
      ]);
    }
  });

  it('closes the metrics of a disposed public Agent while a peer Agent keeps its metrics', async () => {
    const first = await openRouteAAgent();
    const peer = await openRouteAAgent();
    try {
      expect(() => first.agent.metrics.reset()).not.toThrow();
      await first.agent.dispose();
      expect(() => first.agent.metrics.reset()).toThrow(
        'Session metrics are closed',
      );
      expect(() => first.agent.metrics.setLastPromptTokenCount(1)).toThrow(
        'Session metrics are closed',
      );
      expect(() => peer.agent.metrics.setLastPromptTokenCount(9)).not.toThrow();
      expect(peer.agent.metrics.getLastPromptTokenCount()).toBe(9);
      expect(peer.agent.getStats().contextWindowUsed).toBe(9);
    } finally {
      await runCleanupSteps([() => peer.close(), () => first.close()]);
    }
  });
});
