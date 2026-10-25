/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type Agent } from '@vybestack/llxprt-code-agents';
import {
  type CompletedToolCall,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { createGatedRecordingMcp } from '../../../agents/src/api/__tests__/helpers/gated-recording-mcp.js';
import { openRouteAAgent } from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useReactToolScheduler } from '../ui/hooks/useReactToolScheduler.js';
import { renderHook } from './render.js';

const noop = (): void => {};

const CHILD_TOOL = 'child_record';
const CHILD_REPLAY = fileURLToPath(
  new URL('./fixtures/child-record-tool-then-done.jsonl', import.meta.url),
);

type SchedulerHook = ReturnType<
  typeof renderHook<ReturnType<typeof useReactToolScheduler>>
>;

/**
 * One Route A agent whose `task` tool launches a real child that calls a gated
 * stdio MCP tool. The child's model turns come from the replay seam
 * (`child-record-tool-then-done.jsonl`: one `same-child-call` tool call, then
 * `Done`). The gate and the effects belong to this owner's own MCP server.
 */
export interface ChildToolOwner {
  readonly agent: Agent;
  /** The mounted scheduler hook, absent when the owner was opened headless. */
  readonly hook: SchedulerHook | undefined;
  /** Completions the mounted scheduler reported (primary and child calls). */
  readonly completed: Array<{ primary: boolean; calls: CompletedToolCall[] }>;
  /** Resolves once the child tool call has reached this owner's MCP server. */
  readonly entered: () => Promise<void>;
  /** Lets the held child tool call return. */
  readonly release: () => Promise<void>;
  /** The owner's label once per child tool call its MCP server received. */
  readonly effects: () => Promise<readonly string[]>;
  /** Runs the `task` tool through the mounted hook, or a client channel. */
  readonly run: (detached?: boolean) => Promise<void>;
  /** `terminate_reason` of every `task` result the owner has completed. */
  readonly terminateReasons: () => readonly string[];
}

const taskResult = z.object({
  type: z.literal('tool_response'),
  result: z.object({
    output: z.string().transform((text): unknown => JSON.parse(text)),
  }),
});

const taskOutput = z.object({ terminate_reason: z.string() });

function terminateReasonOf(call: CompletedToolCall): string[] {
  if (call.request.name !== 'task' || call.status !== 'success') return [];
  return call.response.responseParts.flatMap((part) => {
    const result = taskResult.safeParse(part);
    return result.success
      ? [taskOutput.parse(result.data.result.output).terminate_reason]
      : [];
  });
}

async function saveWorkerSubagent(agent: Agent): Promise<void> {
  const profileName = `child-${randomUUID()}`;
  await agent.workspace.profileWrites.saveProfile(profileName, {
    version: 1,
    provider: 'fake',
    model: 'fake-model',
    modelParams: {},
    ephemeralSettings: {},
  });
  await agent.workspace.subagentWrites.saveSubagent(
    'worker',
    profileName,
    'Run one record tool.',
  );
}

function mountScheduler(
  agent: Agent,
  completed: ChildToolOwner['completed'],
): SchedulerHook {
  const openClientChannel = (): ReturnType<
    Agent['tools']['openClientChannel']
  > => agent.tools.openClientChannel();
  const subscribeChildTools: Agent['tools']['subscribeChildTools'] = (
    callbacks,
  ) => agent.tools.subscribeChildTools(callbacks);
  return renderHook(() =>
    useReactToolScheduler(
      (_id, calls, options) => {
        completed.push({ primary: options.isPrimary, calls });
      },
      openClientChannel,
      subscribeChildTools,
      noop,
      () => undefined,
      noop,
    ),
  );
}

function taskRequest(name: string, childToolName: string): ToolCallRequestInfo {
  return {
    callId: `${name}-task`,
    name: 'task',
    args: {
      subagent_name: 'worker',
      goal_prompt: 'Record work',
      tool_whitelist: [childToolName],
    },
    prompt_id: `${name}-prompt`,
    isClientInitiated: false,
  };
}

function enterChildReplay(): () => void {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = CHILD_REPLAY;
  return (): void => {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  };
}

export async function openChildToolOwner(
  name: string,
  mounted = true,
): Promise<{
  readonly owner: ChildToolOwner;
  readonly close: () => Promise<void>;
}> {
  const restoreReplay = enterChildReplay();
  const steps: Array<() => void | Promise<void>> = [];
  const close = (): Promise<void> =>
    runCleanupSteps(steps.splice(0).reverse()).finally(restoreReplay);
  try {
    const mcp = await createGatedRecordingMcp({
      toolName: CHILD_TOOL,
      gated: true,
    });
    steps.push(() => mcp.close());
    const route = await openRouteAAgent({
      config: {
        sessionId: 'equal-child-owner-label',
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
        interactive: true,
        mcpServers: mcp.mcpServers,
      },
    });
    steps.push(
      () => route.close(),
      () => mcp.release(),
    );
    const agent = route.agent;
    await saveWorkerSubagent(agent);
    const request = taskRequest(name, (await mcp.tool(agent)).name);
    const completed: ChildToolOwner['completed'] = [];
    const channelResults: CompletedToolCall[] = [];
    const openChannel = (): ReturnType<Agent['tools']['openClientChannel']> =>
      agent.tools.openClientChannel((calls) => {
        channelResults.push(...calls);
      });
    const hook = mounted ? mountScheduler(agent, completed) : undefined;
    if (hook) await waitFor(() => expect(hook.result.current[5]).toBe(true));
    const channel = mounted ? undefined : openChannel();
    if (channel) {
      steps.push(() => channel.release());
      await channel.ready;
    }
    const owner: ChildToolOwner = {
      agent,
      hook,
      completed,
      entered: () => mcp.entered(),
      release: () => mcp.release(),
      effects: async () =>
        (await mcp.effects())
          .filter((effect) => effect.event === 'entered')
          .map(() => name),
      run: async (detached = false) => {
        const signal = new AbortController().signal;
        if (detached) {
          const execution = openChannel();
          try {
            await execution.schedule(request, signal);
          } finally {
            await execution.release();
          }
        } else if (hook) await hook.result.current[1](request, signal);
        else await channel?.schedule(request, signal);
      },
      terminateReasons: () =>
        [
          ...completed.flatMap((entry) => entry.calls),
          ...channelResults,
        ].flatMap(terminateReasonOf),
    };
    return { owner, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
