/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import { fileURLToPath } from 'node:url';
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
  /**
   * The MCP server's `trust` setting. Defaults to true (the tool runs without
   * a confirmation); false makes the call wait for an approval.
   */
  readonly trust?: boolean;
  /**
   * When false the mounted scheduler hook is unmounted again before the owner
   * is returned. Defaults to true (the hook is mounted and ready).
   */
  readonly awaitReady?: boolean;
}

/**
 * One Route A agent with a gated stdio MCP tool (`external_record`) and a
 * mounted `useReactToolScheduler` hook over its client channel. The gate and
 * the effects belong to this owner's own MCP server.
 */
export interface ClientToolOwner {
  readonly agent: Agent;
  readonly hook: SchedulerHook;
  /** Completions the mounted scheduler reported. */
  readonly completed: CompletedToolCall[][];
  /** Resolves once the tool call has reached this owner's MCP server. */
  readonly entered: () => Promise<void>;
  /** Lets the held tool call return. */
  readonly release: () => Promise<void>;
  /** The owner's label once per tool call its MCP server received. */
  readonly effects: () => Promise<readonly string[]>;
  /** A client-initiated request for this owner's tool. */
  readonly request: (callId: string) => ToolCallRequestInfo;
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

function clientRequest(toolName: string, callId: string): ToolCallRequestInfo {
  return {
    callId,
    name: toolName,
    args: {},
    isClientInitiated: true,
    prompt_id: callId,
  };
}

export async function openClientToolOwner(
  name: string,
  options: ClientToolOwnerOptions = {},
): Promise<{
  readonly owner: ClientToolOwner;
  readonly close: () => Promise<void>;
}> {
  const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = PLAIN_TEXT_REPLAY;
  const restoreReplay = (): void => {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  };
  const steps: Array<() => void | Promise<void>> = [];
  const close = (): Promise<void> =>
    runCleanupSteps(steps.splice(0).reverse()).finally(restoreReplay);
  try {
    const mcp = await createGatedRecordingMcp({
      toolName: CLIENT_TOOL,
      gated: true,
      trust: options.trust,
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
      },
    });
    steps.push(
      () => route.close(),
      () => mcp.release(),
    );
    const agent = route.agent;
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
      request: (callId) => clientRequest(toolName, callId),
    };
    return { owner, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
