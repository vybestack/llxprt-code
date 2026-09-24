/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import type { CallableTool } from '@vybestack/llxprt-code-tools';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { AgentImpl } from '../agentImpl.js';

type Scheduler = Awaited<ReturnType<Agent['scheduler']['acquire']>>;

async function schedule(
  agent: Agent,
  registry: ReturnType<Agent['getToolRegistry']>,
  name: string,
  args: Record<string, unknown>,
  results: string[] = [],
): Promise<{ scheduler: Scheduler; completed: Promise<void> }> {
  const scheduler = await agent.scheduler.acquire(
    agent,
    'session',
    {
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (calls) => {
        results.push(
          ...calls.map((call) => String(call.response.resultDisplay)),
        );
      },
    },
    { interactiveMode: true },
    { messageBus: agent.getMessageBus(), toolRegistry: registry },
  );
  const completed = scheduler.schedule(
    [
      {
        callId: `${name}-call`,
        name,
        args,
        isClientInitiated: false,
        prompt_id: name,
      },
    ],
    new AbortController().signal,
  );
  return { scheduler, completed };
}

async function approveOn(
  bus: MessageBus,
  pending: Promise<ToolConfirmationRequest>,
): Promise<void> {
  const request = await pending;
  bus.publish({
    type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
    correlationId: request.correlationId,
    outcome: ToolConfirmationOutcome.ProceedOnce,
  } satisfies ToolConfirmationResponse);
}

function nextApproval(bus: MessageBus): Promise<ToolConfirmationRequest> {
  return new Promise((resolve) => {
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        unsubscribe();
        resolve(request);
      },
    );
  });
}

describe('session registry isolation on a caller-owned Config', () => {
  it('keeps two same-label plain agents independent and leaves the caller registry untouched', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const config = built.config;
    const base = config.getToolRegistry();
    const originalShell = base.getTool('run_shell_command');
    const originalTask = base.getTool('task');
    const firstBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const secondBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    let first: Agent | undefined;
    let second: Agent | undefined;
    try {
      first = await fromConfig({
        config,
        sessionId: 'same-label',
        messageBus: firstBus,
      });
      second = await fromConfig({
        config,
        sessionId: 'same-label',
        messageBus: secondBus,
      });
      const aRegistry = first.getToolRegistry();
      const bRegistry = second.getToolRegistry();
      expect(aRegistry).not.toBe(base);
      expect(bRegistry).not.toBe(base);
      expect(aRegistry).not.toBe(bRegistry);
      expect(aRegistry.getTool('task')).not.toBe(bRegistry.getTool('task'));
      expect(aRegistry.getTool('run_shell_command')).not.toBe(
        bRegistry.getTool('run_shell_command'),
      );
      expect(base.getTool('task')).toBe(originalTask);
      expect(base.getTool('run_shell_command')).toBe(originalShell);
      const aTask = aRegistry.getTool('task');
      const bTask = bRegistry.getTool('task');
      expect(aTask).toBeDefined();
      expect(bTask).toBeDefined();
      await first.dispose();
      const result = await bTask!
        .build({ subagent_name: 'missing-worker', goal_prompt: 'check B' })
        .execute(new AbortController().signal);
      expect(String(result.llmContent)).not.toContain(
        'Session scheduler owner is disposed',
      );
      const shell = bRegistry.getTool('run_shell_command');
      expect(shell).toBeDefined();
      const output = await shell!
        .build({
          command: 'printf session-b',
          description: 'print session marker',
        })
        .execute(new AbortController().signal);
      expect(String(output.llmContent)).toContain('session-b');
    } finally {
      await Promise.all([first?.dispose(), second?.dispose()]);
      await built.cleanup();
    }
  }, 30000);

  it('dispatches simultaneous shell calls through the two plain session registries', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const config = built.config;
    const busA = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const busB = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    let a: Agent | undefined;
    let b: Agent | undefined;
    try {
      a = await fromConfig({
        config,
        sessionId: 'same-label',
        messageBus: busA,
      });
      b = await fromConfig({
        config,
        sessionId: 'same-label',
        messageBus: busB,
      });
      const resultsA: string[] = [];
      const resultsB: string[] = [];
      const pendingA = nextApproval(busA);
      const pendingB = nextApproval(busB);
      const runA = await schedule(
        a,
        config.getToolRegistry(),
        'run_shell_command',
        {
          command: 'printf owner-a',
          description: 'print A',
        },
        resultsA,
      );
      const runB = await schedule(
        b,
        config.getToolRegistry(),
        'run_shell_command',
        {
          command: 'printf owner-b',
          description: 'print B',
        },
        resultsB,
      );
      await Promise.all([approveOn(busA, pendingA), approveOn(busB, pendingB)]);
      await Promise.all([runA.completed, runB.completed]);
      for (
        let attempt = 0;
        attempt < 100 && (resultsA.length === 0 || resultsB.length === 0);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(resultsA.join(' ')).toContain('owner-a');
      expect(resultsA.join(' ')).not.toContain('owner-b');
      expect(resultsB.join(' ')).toContain('owner-b');
      expect(resultsB.join(' ')).not.toContain('owner-a');
      a.scheduler.release(a, 'session', runA.scheduler);
      b.scheduler.release(b, 'session', runB.scheduler);
    } finally {
      await Promise.all([a?.dispose(), b?.dispose()]);
      await built.cleanup();
    }
  }, 30000);

  it('routes late MCP confirmation and execution through the invoking plain agent bus', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const config = built.config;
    const firstBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const secondBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    let first: Agent | undefined;
    let second: Agent | undefined;
    let unsubscribeFirst: (() => void) | undefined;
    try {
      first = await fromConfig({
        config,
        sessionId: 'same-label',
        messageBus: firstBus,
      });
      second = await fromConfig({
        config,
        sessionId: 'same-label',
        messageBus: secondBus,
      });
      await second.chat('initialize tools');
      const calls: string[] = [];
      const callable: CallableTool = {
        tool: async () => ({ functionDeclarations: [] }),
        callTool: async () => {
          calls.push('called');
          return [
            {
              functionResponse: {
                name: 'late',
                response: { content: [{ type: 'text', text: 'done' }] },
              },
            },
          ];
        },
      };
      const mcp = new DiscoveredMCPTool(
        callable,
        'late-session-b',
        'late',
        'late tool',
        { type: 'object' },
      );
      config.getToolRegistry().registerTool(mcp);
      await config.refreshDiscoveredMcpMetadata();
      expect(second.getToolRegistry().getTool(mcp.name)).toBeDefined();
      expect(second.getToolRegistry().getTool(mcp.name)).not.toBe(mcp);
      if (!(second instanceof AgentImpl))
        throw new Error('Expected a real Agent');
      const chat = second.agentClient.getChat() as unknown as {
        generationConfig?: {
          tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
        };
      };
      expect(
        chat.generationConfig?.tools?.[0]?.functionDeclarations?.map(
          (tool) => tool.name,
        ),
      ).toContain(mcp.name);
      let firstRequests = 0;
      unsubscribeFirst = firstBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        () => {
          firstRequests++;
        },
      );
      const bApproval = nextApproval(secondBus);
      const running = await schedule(
        second,
        second.getToolRegistry(),
        mcp.name,
        {},
      );
      await approveOn(secondBus, bApproval);
      await running.completed;
      expect(calls).toStrictEqual(['called']);
      expect(firstRequests).toBe(0);
      second.scheduler.release(second, 'session', running.scheduler);
    } finally {
      unsubscribeFirst?.();
      await Promise.all([first?.dispose(), second?.dispose()]);
      await built.cleanup();
    }
  }, 30000);
});
