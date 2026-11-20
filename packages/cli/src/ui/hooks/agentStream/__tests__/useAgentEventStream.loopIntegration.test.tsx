/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { openRouteAAgent } from '../../../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { createGatedEchoMcp } from '../../../../../../agents/src/api/__tests__/helpers/gated-echo-mcp.js';
import { awaitMcpDiscoveryReady } from '../../../../../../agents/src/api/__tests__/helpers/mcp-discovery-ready.js';
import { agentStreamOperations } from './helpers/agentStreamOperations.js';
import {
  PolicyDecision,
  ToolConfirmationOutcome,
  type IContent,
  type ToolCall,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../__tests__/render.js';
import { readJournalItems } from '../../../stores/turn/journal-turn-test-helpers.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import { gate, scriptProvider } from './journal-provider-test-helpers.js';
import { ToolCallStatus } from '../../../types.js';

type LoopFixture = {
  agent: Agent;
  state: () => readonly ToolCall[];
  awaitApproval(): Promise<void>;
  run(signal?: AbortSignal): Promise<void>;
  unmount(): void;
};

async function withLoop(
  decision: PolicyDecision,
  run: (fixture: LoopFixture) => Promise<void>,
): Promise<void> {
  const mcp = await createGatedEchoMcp({
    toolName: 'echo_tool',
    outputPrefix: 'echoed display',
    trust: decision === PolicyDecision.ALLOW,
  });
  const route = await openRouteAAgent({
    config: {
      interactive: true,
      folderTrust: true,
      mcpServers: mcp.mcpServers,
      recording: { enabled: false },
      policy: {
        rules: [{ toolName: 'echo__echo_tool', decision, priority: 1000 }],
      },
    },
  });
  const agent = route.agent;
  await awaitMcpDiscoveryReady(agent);
  await mcp.release();
  await agent.session.setRecording({ enabled: true });
  const operations = agentStreamOperations(agent);
  let calls: readonly ToolCall[] = [];
  const approval = gate();
  const rendered = renderHook(() =>
    useAgentEventStream({
      ...operations,
      addItem: () => {
        throw new Error('Duplicate CLI transcript write');
      },
      processAgentEventRef: { current: null },
      flushPendingHistoryItem: () => {},
      clearPendingHistoryItem: () => {},
      performMemoryRefresh: async () => {},
      onToolCallsUpdate: (next) => {
        calls = next;
        if (next.some((call) => call.status === 'awaiting_approval'))
          approval.release();
      },
    }),
  );
  try {
    await run({
      agent,
      state: () => calls,
      awaitApproval: () => approval.promise,
      unmount: rendered.unmount,
      run: async (signal = new AbortController().signal) => {
        await rendered.result.current.runStream('go', signal, 'loop-prompt');
      },
    });
  } finally {
    rendered.unmount();
    await route.close();
    await mcp.close();
  }
}

const request: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'Before the tool' },
    {
      type: 'tool_call',
      id: 'call-1',
      name: 'mcp__echo__echo_tool',
      parameters: { invocation: 'result' },
    },
  ],
};
const answer: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'Final answer' }],
};

function conversation(
  agent: LoopFixture['agent'],
): ReturnType<typeof scriptProvider> {
  let turn = 0;
  return scriptProvider(agent, async function* () {
    yield turn++ === 0 ? request : answer;
  });
}

async function confirm(
  fixture: LoopFixture,
  outcome: ToolConfirmationOutcome,
): Promise<void> {
  await fixture.awaitApproval();
  expect(fixture.state()[0]?.status).toBe('awaiting_approval');
  const waiting = fixture.state()[0];
  if (
    waiting.status !== 'awaiting_approval' ||
    !('onConfirm' in waiting.confirmationDetails)
  )
    throw new Error('Missing live approval');
  await waiting.confirmationDetails.onConfirm(outcome);
}

async function assertCompletedJournal(fixture: LoopFixture): Promise<void> {
  const items = await readJournalItems(fixture.agent);
  expect(
    items
      .flatMap((item) => (item.type === 'tool_group' ? item.tools : []))
      .map((tool) => [tool.callId, tool.status, tool.resultDisplay]),
  ).toStrictEqual([['call-1', 'Success', 'echoed display:result']]);
  expect(
    items.flatMap((item) => {
      if (item.type === 'gemini') return [item.text];
      return item.type === 'tool_group' ? ['tool'] : [];
    }),
  ).toStrictEqual(['Before the tool', 'tool', 'Final answer']);
  expect(
    (await fixture.agent.session.getHistory())
      .flatMap((row) => row.blocks)
      .filter((block) => block.type === 'tool_response')
      .map((block) => block.callId),
  ).toStrictEqual(['call-1']);
}

describe('useAgentEventStream real loop integration', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  it('records the tool continuation once and displays rationale, result and answer in order', async () => {
    await withLoop(PolicyDecision.ALLOW, async (fixture) => {
      const provider = conversation(fixture.agent);
      try {
        await act(async () => fixture.run());
        await assertCompletedJournal(fixture);
        expect(provider.mock.calls).toHaveLength(2);
      } finally {
        provider.mockRestore();
      }
    });
  });

  it('settles cancellation and preserves partial text while rejecting late output', async () => {
    await withLoop(PolicyDecision.ALLOW, async (fixture) => {
      const entered = gate();
      const finish = gate();
      const provider = scriptProvider(fixture.agent, async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Partial text' }],
        };
        entered.release();
        await finish.promise;
        yield answer;
      });
      const controller = new AbortController();
      const running = fixture.run(controller.signal);
      try {
        await entered.promise;
        controller.abort();
      } finally {
        finish.release();
        await running;
        provider.mockRestore();
      }
      const items = await readJournalItems(fixture.agent);
      const text = items
        .filter((item) => item.type === 'gemini')
        .map((item) => item.text);
      expect(text).toContain('Partial text');
      expect(text.join('')).not.toContain('Final answer');
      expect(controller.signal.aborted).toBe(true);
    });
  });

  it('continues after ProceedOnce through the live confirmation callback and records the completed tool', async () => {
    await withLoop(PolicyDecision.ASK_USER, async (fixture) => {
      const provider = conversation(fixture.agent);
      const running = fixture.run();
      try {
        await confirm(fixture, ToolConfirmationOutcome.ProceedOnce);
        await running;
        await assertCompletedJournal(fixture);
        expect(provider.mock.calls).toHaveLength(2);
      } finally {
        provider.mockRestore();
      }
    });
  });

  it('ends the turn after Cancel through the live confirmation callback', async () => {
    await withLoop(PolicyDecision.ASK_USER, async (fixture) => {
      const provider = conversation(fixture.agent);
      const running = fixture.run();
      try {
        await confirm(fixture, ToolConfirmationOutcome.Cancel);
        await running;
        expect(fixture.state()).toStrictEqual([]);
        const items = await readJournalItems(fixture.agent);
        expect(
          items
            .flatMap((item) => (item.type === 'tool_group' ? item.tools : []))
            .map((tool) => tool.status),
        ).toStrictEqual([ToolCallStatus.Canceled]);
        expect(provider.mock.calls).toHaveLength(1);
      } finally {
        provider.mockRestore();
      }
    });
  });

  it('detaches display callbacks on unmount without stopping journal recording', async () => {
    await withLoop(PolicyDecision.ALLOW, async (fixture) => {
      const entered = gate();
      const finish = gate();
      const provider = scriptProvider(fixture.agent, async function* () {
        entered.release();
        await finish.promise;
        yield answer;
      });
      const running = fixture.run();
      try {
        await entered.promise;
        fixture.unmount();
      } finally {
        finish.release();
        await running;
        provider.mockRestore();
      }
      expect(
        (await readJournalItems(fixture.agent))
          .filter((item) => item.type === 'gemini')
          .map((item) => item.text),
      ).toStrictEqual(['Final answer']);
      expect(fixture.state()).toStrictEqual([]);
    });
  });
});
