/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgent,
  fromConfig,
  type Agent,
  type AgentConfig,
} from '@vybestack/llxprt-code-agents';
import {
  PolicyDecision,
  type CompletedToolCall,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  createGatedRecordingMcp,
  type GatedRecordingMcp,
} from '../../../agents/src/api/__tests__/helpers/gated-recording-mcp.js';
import type { RecordingProvider } from '../../../agents/src/api/__tests__/helpers/recording-provider.js';
import {
  openRouteAAgent,
  type RouteAAgent,
} from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useReactToolScheduler } from '../ui/hooks/useReactToolScheduler.js';
import { renderHook } from './render.js';

const noop = (): void => {};

const CLIENT_TOOL = 'external_record';
const REPLAYS = {
  /** One plain-text model turn. */
  'plain-text': fileURLToPath(
    new URL(
      '../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
      import.meta.url,
    ),
  ),
} as const;

type SchedulerHook = ReturnType<
  typeof renderHook<ReturnType<typeof useReactToolScheduler>>
>;

export interface ClientToolOwnerOptions {
  /**
   * The policy decision for the owner's client tool. Defaults to ALLOW;
   * ASK_USER makes a call wait for an approval.
   */
  readonly decision?: PolicyDecision;
  /**
   * A contributed provider that scripts the model's turns and counts its
   * requests. The agent is then built through `createAgent` (Route C) and the
   * chat is left to the scenario; `borrow` is unavailable. Without it the
   * agent is Route A with the fake-responses replay, and the owner starts the
   * chat with one setup turn so client channel completions are persisted.
   */
  readonly modelProvider?: RecordingProvider;
  /** When false the mounted scheduler hook is unmounted right away. */
  readonly awaitReady?: boolean;
}

/**
 * One Route A agent that owns a gated stdio MCP tool, with a mounted CLI
 * scheduler hook. The gate and the effects belong to this owner's own MCP
 * server, so two owners never share them.
 */
export interface ClientToolOwner {
  readonly agent: Agent;
  readonly hook: SchedulerHook;
  /** Completions the mounted scheduler reported. */
  readonly completed: CompletedToolCall[][];
  /** Resolves once a call has reached this owner's MCP server. */
  readonly entered: () => Promise<void>;
  /** Lets every held and later tool call return. */
  readonly release: () => Promise<void>;
  /** The owner's label once per tool call its MCP server received. */
  readonly effects: () => Promise<readonly string[]>;
  /** The agent's name for the owner's tool (what a request must call). */
  readonly toolName: string;
  /** A client-initiated request for the owner's tool. */
  readonly request: (callId: string) => ToolCallRequestInfo;
  /**
   * A second agent built through `fromConfig` on this owner's `Config`,
   * settings and credential authority, closed with the owner. Rejects for an
   * owner built with a `modelProvider`.
   */
  readonly borrow: () => Promise<Agent>;
}

function enterReplay(replay: keyof typeof REPLAYS): () => void {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = REPLAYS[replay];
  return (): void => {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  };
}

function mountScheduler(
  agent: Agent,
  completed: CompletedToolCall[][],
): SchedulerHook {
  const openClientChannel = (): ReturnType<
    Agent['tools']['openClientChannel']
  > => agent.tools.openClientChannel();
  const subscribeChildTools: Agent['tools']['subscribeChildTools'] = (
    callbacks,
  ) => agent.tools.subscribeChildTools(callbacks);
  return renderHook(() =>
    useReactToolScheduler(
      (_id, calls) => {
        completed.push(calls);
      },
      openClientChannel,
      subscribeChildTools,
      noop,
      () => undefined,
      noop,
    ),
  );
}

function borrowRouteAAgent(
  route: Pick<RouteAAgent, 'config' | 'settings' | 'authority'>,
): Promise<Agent> {
  return fromConfig(
    route.config,
    route.settings,
    { activation: { provider: 'fake', model: 'fake-model' } },
    route.authority,
  );
}

interface OwnerAgent {
  readonly agent: Agent;
  readonly borrow: () => Promise<Agent>;
}

type OwnerConfig = Pick<
  AgentConfig,
  | 'sessionId'
  | 'folderTrust'
  | 'telemetry'
  | 'recording'
  | 'interactive'
  | 'mcpServers'
  | 'policy'
>;

async function openRouteCAgent(
  config: OwnerConfig,
  provider: RecordingProvider,
  steps: Array<() => void | Promise<void>>,
  mcp: GatedRecordingMcp,
): Promise<OwnerAgent> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'client-tool-owner-')),
  );
  steps.push(() => rm(directory, { recursive: true, force: true }));
  const agent = await createAgent({
    ...config,
    provider: provider.alias,
    model: 'recording-default',
    workingDir: directory,
    providerContributions: provider.contributions,
  });
  steps.push(
    () => agent.dispose(),
    () => mcp.release(),
  );
  return {
    agent,
    borrow: () =>
      Promise.reject(new Error('A Route C owner has no borrowable Config')),
  };
}

async function openRouteAOwnerAgent(
  config: OwnerConfig,
  steps: Array<() => void | Promise<void>>,
  mcp: GatedRecordingMcp,
): Promise<OwnerAgent> {
  const route = await openRouteAAgent({ config });
  steps.push(
    () => route.close(),
    () => mcp.release(),
  );
  return {
    agent: route.agent,
    borrow: async () => {
      const borrowed = await borrowRouteAAgent(route);
      steps.push(() => borrowed.dispose());
      await mcp.tool(borrowed);
      return borrowed;
    },
  };
}

export async function openClientToolOwner(
  name: string,
  options: ClientToolOwnerOptions = {},
): Promise<{
  readonly owner: ClientToolOwner;
  readonly close: () => Promise<void>;
}> {
  const decision = options.decision ?? PolicyDecision.ALLOW;
  const restoreReplay =
    options.modelProvider === undefined
      ? enterReplay('plain-text')
      : (): void => {};
  const steps: Array<() => void | Promise<void>> = [];
  const close = (): Promise<void> =>
    runCleanupSteps(steps.splice(0).reverse()).finally(restoreReplay);
  try {
    const mcp = await createGatedRecordingMcp({
      toolName: CLIENT_TOOL,
      gated: true,
    });
    steps.push(() => mcp.close());
    const config: OwnerConfig = {
      sessionId: 'client-tool-equal-label',
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      interactive: true,
      mcpServers: mcp.mcpServers,
      policy: {
        rules: [
          {
            toolName: `${mcp.serverName}__${mcp.toolName}`,
            decision,
            priority: 1000,
          },
        ],
      },
    };
    const { agent, borrow } =
      options.modelProvider === undefined
        ? await openRouteAOwnerAgent(config, steps, mcp)
        : await openRouteCAgent(config, options.modelProvider, steps, mcp);
    if (options.modelProvider === undefined)
      await agent.chat('Start the conversation');
    const toolName = (await mcp.tool(agent)).name;
    const completed: CompletedToolCall[][] = [];
    const hook = mountScheduler(agent, completed);
    if (options.awaitReady ?? true)
      await waitFor(() => expect(hook.result.current[5]).toBe(true));
    else hook.unmount();
    const owner: ClientToolOwner = {
      agent,
      hook,
      completed,
      entered: () => mcp.entered(),
      release: () => mcp.release(),
      effects: async () =>
        (await mcp.effects())
          .filter((effect) => effect.event === 'entered')
          .map(() => name),
      toolName,
      request: (callId) => ({
        callId,
        name: toolName,
        args: {},
        isClientInitiated: true,
        prompt_id: callId,
      }),
      borrow,
    };
    return { owner, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
