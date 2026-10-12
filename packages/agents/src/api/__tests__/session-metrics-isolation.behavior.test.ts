/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  ApiResponseEvent,
  ToolCallEvent,
  logApiResponse,
  logToolCall,
} from '@vybestack/llxprt-code-telemetry';
import {
  buildAgent,
  drain,
  internalConfig,
  internalSettingsOwner,
  type Agent,
} from './helpers/agentHarness.js';

function response(
  agent: Agent,
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
  logApiResponse(
    internalConfig(agent),
    event,
    internalSettingsOwner(agent).telemetry,
  );
}

function tool(agent: Agent): void {
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
  logToolCall(
    internalConfig(agent),
    event,
    internalSettingsOwner(agent).telemetry,
  );
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
  it('isolates interleaved turns, equal attempt/tool IDs, subscriptions and session clearing', async () => {
    const a = await buildAgent('multi-turn-text.jsonl', {
      sessionId: 'same-label',
    });
    const b = await buildAgent('multi-turn-text.jsonl', {
      sessionId: 'same-label',
    });
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
      response(a.agent, 'same-attempt', 40, 10);
      tool(a.agent);
      expect(counters(b.agent)).toStrictEqual(initialB);
      await drain(b.agent.stream('hello B'));
      const bTurn = counters(b.agent);
      response(b.agent, 'same-attempt', 70, 20);
      tool(b.agent);
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
      response(a.agent, 'new-attempt', 15, 5);
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
      response(b.agent, 'after-unsubscribe', 5, 3);
      expect(bUpdates).toHaveLength(framesBeforeClear);
    } finally {
      await b.cleanup();
      await a.cleanup();
    }
  });

  it('retires A metrics subscriptions while B continues producing stats', async () => {
    const a = await buildAgent('multi-turn-text.jsonl', {
      sessionId: 'same-label',
    });
    const b = await buildAgent('multi-turn-text.jsonl', {
      sessionId: 'same-label',
    });
    try {
      response(a.agent, 'attempt-a', 40, 10);
      response(b.agent, 'attempt-b', 70, 20);
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
      expect(() => a.agent.metrics.reset()).toThrow(
        'Session metrics are closed',
      );
      expect(() => a.agent.metrics.setLastPromptTokenCount(1)).toThrow(
        'Session metrics are closed',
      );
      expect(counters(b.agent)).toStrictEqual(before);
      await drain(b.agent.stream('still working'));
      const afterTurn = counters(b.agent);
      response(b.agent, 'attempt-b2', 5, 3);
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
});
