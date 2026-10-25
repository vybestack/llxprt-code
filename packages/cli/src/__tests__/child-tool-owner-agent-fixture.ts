/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type Agent, type AgentConfig } from '@vybestack/llxprt-code-agents';
import {
  PolicyDecision,
  type CompletedToolCall,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { createGatedRecordingMcp } from '../../../agents/src/api/__tests__/helpers/gated-recording-mcp.js';
import { createGatedEchoMcp } from '../../../agents/src/api/__tests__/helpers/gated-echo-mcp.js';
import { awaitMcpDiscoveryReady } from '../../../agents/src/api/__tests__/helpers/mcp-discovery-ready.js';
import { openRouteAAgent } from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useReactToolScheduler } from '../ui/hooks/useReactToolScheduler.js';
import { renderHook } from './render.js';

const noop = (): void => {};

const CHILD_TOOL = 'child_record';
// The policy engine names an MCP tool `<server>__<tool>`; the agent catalog prefixes `mcp__`.
const CHILD_TOOL_NAME = `mcp__recording__${CHILD_TOOL}`;
const CHILD_POLICY_TOOL_NAME = `recording__${CHILD_TOOL}`;
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
  /** `agent_id` of every `task` result the owner has completed. */
  readonly childAgentIds: () => readonly string[];
}

/**
 * How the child's tool call is decided: `allow` runs it, `ask` raises a
 * confirmation the mounted display (or channel) must answer, `deny` excludes
 * the tool so the call fails without reaching the tool.
 */
export type ChildToolDecision = 'allow' | 'ask' | 'deny';

export interface ChildToolOwnerOptions {
  readonly decision?: ChildToolDecision;
  /**
   * The MCP tool answers `<text>:undefined` instead of `recorded`, so the
   * displayed result tells the owners apart.
   */
  readonly outputText?: string;
  /**
   * The child runs a gated shell command that prints this text, instead of
   * the MCP tool. A shell tool streams its output while it runs; an MCP tool
   * does not.
   */
  readonly streamingShellText?: string;
}

const taskResult = z.object({
  type: z.literal('tool_response'),
  result: z.object({
    output: z.string().transform((text): unknown => JSON.parse(text)),
  }),
});

const taskOutput = z.object({
  agent_id: z.string(),
  terminate_reason: z.string(),
});

function taskOutputsOf(call: CompletedToolCall): Array<{
  agent_id: string;
  terminate_reason: string;
}> {
  if (call.request.name !== 'task' || call.status !== 'success') return [];
  return call.response.responseParts.flatMap((part) => {
    const result = taskResult.safeParse(part);
    return result.success ? [taskOutput.parse(result.data.result.output)] : [];
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

/** What the child tool does and how the test holds, releases and counts it. */
interface ChildToolGate {
  readonly replay: string;
  readonly config: Partial<AgentConfig>;
  readonly toolName: (agent: Agent) => Promise<string>;
  readonly entered: () => Promise<void>;
  readonly release: () => Promise<void>;
  /** Number of times the child tool was entered. */
  readonly callCount: () => Promise<number>;
  readonly close: () => Promise<void>;
}

/** A DENY rule on the child tool, through the public `AgentConfig.policy` input. */
function denyPolicy(decision: ChildToolDecision): Partial<AgentConfig> {
  if (decision !== 'deny') return {};
  return {
    policy: {
      defaultDecision: PolicyDecision.ASK_USER,
      rules: [
        { toolName: 'task', decision: PolicyDecision.ALLOW, priority: 1 },
        {
          toolName: CHILD_POLICY_TOOL_NAME,
          decision: PolicyDecision.DENY,
          priority: 10000,
        },
      ],
    },
  };
}

async function openMcpGate(
  decision: ChildToolDecision,
  outputText: string | undefined,
  steps: Array<() => void | Promise<void>>,
): Promise<ChildToolGate> {
  const trust = decision === 'allow';
  if (outputText !== undefined) {
    const echo = await createGatedEchoMcp({
      toolName: CHILD_TOOL,
      serverName: 'recording',
      outputPrefix: outputText,
      trust,
    });
    steps.push(() => echo.close());
    return {
      replay: CHILD_REPLAY,
      config: { mcpServers: echo.mcpServers, ...denyPolicy(decision) },
      toolName: async (agent) => {
        await awaitMcpDiscoveryReady(agent);
        return CHILD_TOOL_NAME;
      },
      entered: () => echo.entered(),
      release: () => echo.release(),
      callCount: async () => (await echo.calls()).length,
      close: () => echo.close(),
    };
  }
  const mcp = await createGatedRecordingMcp({
    toolName: CHILD_TOOL,
    gated: true,
    trust,
  });
  steps.push(() => mcp.close());
  return {
    replay: CHILD_REPLAY,
    config: {
      mcpServers: mcp.mcpServers,
      ...denyPolicy(decision),
    },
    toolName: async (agent) => (await mcp.tool(agent)).name,
    entered: () => mcp.entered(),
    release: () => mcp.release(),
    callCount: async () =>
      (await mcp.effects()).filter((effect) => effect.event === 'entered')
        .length,
    close: () => mcp.close(),
  };
}

const SHELL_POLL = 'while [ ! -e "$RELEASE" ]; do sleep 0.05; done';

async function openStreamingShellGate(
  text: string,
  steps: Array<() => void | Promise<void>>,
): Promise<ChildToolGate> {
  const directory = await mkdtemp(join(tmpdir(), 'child-shell-gate-'));
  steps.push(() => rm(directory, { recursive: true, force: true }));
  const enteredFile = join(directory, 'entered');
  const releaseFile = join(directory, 'release');
  await writeFile(enteredFile, '');
  const command = `RELEASE='${releaseFile}'; printf '%s\\n' '${text}'; echo entered >> '${enteredFile}'; ${SHELL_POLL}`;
  const replay = join(directory, 'replay.jsonl');
  const turns = [
    {
      chunks: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'same-child-call',
              name: 'run_shell_command',
              parameters: { command },
            },
          ],
        },
      ],
    },
    { chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'Done' }] }] },
  ];
  await writeFile(
    replay,
    turns.map((turn) => JSON.stringify(turn)).join('\n') + '\n',
  );
  const lines = async (): Promise<number> =>
    (await readFile(enteredFile, 'utf8')).split('\n').filter(Boolean).length;
  return {
    replay,
    config: { allowedTools: ['run_shell_command'] },
    toolName: () => Promise.resolve('run_shell_command'),
    entered: async () => {
      const deadline = Date.now() + 30_000;
      while ((await lines()) < 1) {
        if (Date.now() > deadline)
          throw new Error('Shell child was not entered');
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    },
    release: () => writeFile(releaseFile, ''),
    callCount: lines,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

function enterReplay(replay: string): () => void {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = replay;
  return (): void => {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  };
}

type ClientChannel = ReturnType<Agent['tools']['openClientChannel']>;

function openGate(
  options: ChildToolOwnerOptions,
  steps: Array<() => void | Promise<void>>,
): Promise<ChildToolGate> {
  return options.streamingShellText === undefined
    ? openMcpGate(options.decision ?? 'allow', options.outputText, steps)
    : openStreamingShellGate(options.streamingShellText, steps);
}

/** Schedules the task through the mounted hook, a detached channel, or the owner's channel. */
async function runTask(
  request: ToolCallRequestInfo,
  detached: boolean,
  route: {
    readonly hook: SchedulerHook | undefined;
    readonly channel: ClientChannel | undefined;
    readonly openChannel: () => ClientChannel;
  },
): Promise<void> {
  const signal = new AbortController().signal;
  if (detached) {
    const execution = route.openChannel();
    try {
      await execution.schedule(request, signal);
    } finally {
      await execution.release();
    }
  } else if (route.hook) await route.hook.result.current[1](request, signal);
  else await route.channel?.schedule(request, signal);
}

export async function openChildToolOwner(
  name: string,
  mounted = true,
  options: ChildToolOwnerOptions = {},
): Promise<{
  readonly owner: ChildToolOwner;
  readonly close: () => Promise<void>;
}> {
  const steps: Array<() => void | Promise<void>> = [];
  let restoreReplay = (): void => {};
  const close = (): Promise<void> =>
    runCleanupSteps(steps.splice(0).reverse()).finally(() => restoreReplay());
  try {
    const gate = await openGate(options, steps);
    restoreReplay = enterReplay(gate.replay);
    const route = await openRouteAAgent({
      config: {
        sessionId: 'equal-child-owner-label',
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
        interactive: true,
        ...gate.config,
      },
    });
    steps.push(
      () => route.close(),
      () => gate.release(),
    );
    const agent = route.agent;
    await saveWorkerSubagent(agent);
    const request = taskRequest(name, await gate.toolName(agent));
    const completed: ChildToolOwner['completed'] = [];
    const channelResults: CompletedToolCall[] = [];
    const openChannel = (): ClientChannel =>
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
    const taskOutputs = (): ReturnType<typeof taskOutputsOf> =>
      [...completed.flatMap((entry) => entry.calls), ...channelResults].flatMap(
        taskOutputsOf,
      );
    const owner: ChildToolOwner = {
      agent,
      hook,
      completed,
      entered: () => gate.entered(),
      release: () => gate.release(),
      effects: async () =>
        Array.from({ length: await gate.callCount() }, () => name),
      run: (detached = false) =>
        runTask(request, detached, { hook, channel, openChannel }),
      terminateReasons: () => taskOutputs().map((out) => out.terminate_reason),
      childAgentIds: () => taskOutputs().map((out) => out.agent_id),
    };
    return { owner, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
