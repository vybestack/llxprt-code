/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { type Agent } from '@vybestack/llxprt-code-agents';
import {
  PolicyDecision,
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

const CLIENT_TOOL = 'external_record';
const PLAIN_TEXT_REPLAY = fileURLToPath(
  new URL(
    '../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    import.meta.url,
  ),
);

type SchedulerHook = ReturnType<
  typeof renderHook<ReturnType<typeof useReactToolScheduler>>
>;

export interface ClientToolOwnerOptions {
  /** The policy decision for the owner's client tool. Defaults to ALLOW. */
  readonly decision?: PolicyDecision;
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
  /** A client-initiated request for the owner's tool. */
  readonly request: (callId: string) => ToolCallRequestInfo;
}

function enterReplay(): () => void {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = PLAIN_TEXT_REPLAY;
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

export async function openClientToolOwner(
  name: string,
  options: ClientToolOwnerOptions = {},
): Promise<{
  readonly owner: ClientToolOwner;
  readonly close: () => Promise<void>;
}> {
  const decision = options.decision ?? PolicyDecision.ALLOW;
  const restoreReplay = enterReplay();
  const steps: Array<() => void | Promise<void>> = [];
  const close = (): Promise<void> =>
    runCleanupSteps(steps.splice(0).reverse()).finally(restoreReplay);
  try {
    const mcp = await createGatedRecordingMcp({
      toolName: CLIENT_TOOL,
      gated: true,
    });
    steps.push(() => mcp.close());
    const route = await openRouteAAgent({
      config: {
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
      },
    });
    steps.push(
      () => route.close(),
      () => mcp.release(),
    );
    const agent = route.agent;
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
      request: (callId) => ({
        callId,
        name: toolName,
        args: {},
        isClientInitiated: true,
        prompt_id: callId,
      }),
    };
    return { owner, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
