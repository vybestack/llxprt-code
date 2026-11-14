/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real public Agent with code mode enabled, over a scripted FakeProvider, for
 * the code mode behavior tests (issue #4084). The provider asks for one or
 * more `execute_tool_script` calls, then answers with text. Everything below
 * the provider is production code: session tool catalog with real builtin
 * tools over a temp workspace, real policy engine and approvals, real
 * scheduler, real QuickJS subprocess.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PolicyRule } from '@vybestack/llxprt-code-core/policy/types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildAgentFromContent,
  drain,
  type Agent,
  type AgentConfig,
  type AgentEvent,
  type ToolConfirmation,
} from '../../api/__tests__/helpers/agentHarness.js';

export interface ScriptCallSpec {
  readonly id?: string;
  readonly source: string;
  readonly tools: readonly string[];
  readonly purpose?: string;
}

export interface ScriptAgent {
  readonly agent: Agent;
  readonly workspace: string;
  cleanup(): Promise<void>;
}

/** The script tool itself is allowed; nested calls keep their own policy. */
export const ALLOW_SCRIPT_TOOL: PolicyRule = {
  toolName: 'execute_tool_script',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

export interface ToolCallSpec {
  readonly id: string;
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

function scriptCall(call: ScriptCallSpec, index: number): ToolCallSpec {
  return {
    id: call.id ?? `script-call-${index + 1}`,
    name: 'execute_tool_script',
    parameters: {
      source: call.source,
      tools: call.tools,
      purpose: call.purpose ?? 'code mode behavior test',
    },
  };
}

/** Provider script: one turn of tool calls, then a text answer. */
export function toolTurns(calls: readonly ToolCallSpec[]): string {
  const toolTurn = {
    chunks: [
      {
        speaker: 'ai',
        blocks: calls.map((call) => ({ type: 'tool_call', ...call })),
      },
    ],
  };
  const answer = {
    chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] }],
  };
  return `${JSON.stringify(toolTurn)}\n${JSON.stringify(answer)}\n`;
}

export interface AgentOptions {
  readonly workspace: string;
  readonly rules?: readonly PolicyRule[];
  readonly config?: Partial<AgentConfig>;
  /**
   * Leave out the explicit allow rule for the script tool, so the default
   * policy alone decides whether it may run.
   */
  readonly defaultScriptPolicy?: boolean;
}

/** An agent whose provider makes the given direct (non-script) tool calls. */
export async function buildDirectAgent(
  calls: readonly ToolCallSpec[],
  options: AgentOptions,
): Promise<ScriptAgent> {
  return buildFromTurns(toolTurns(calls), options);
}

async function buildFromTurns(
  turns: string,
  options: AgentOptions,
): Promise<ScriptAgent> {
  const built = await buildAgentFromContent(turns, {
    workingDir: options.workspace,
    codeMode: true,
    interactive: true,
    harness: { forceConfirmations: false, includeProcessCwd: false },
    policy: {
      rules: [
        ...(options.defaultScriptPolicy === true ? [] : [ALLOW_SCRIPT_TOOL]),
        ...(options.rules ?? []),
      ],
    },
    ...options.config,
  });
  return {
    agent: built.agent,
    workspace: options.workspace,
    cleanup: async () => {
      await built.cleanup();
      rmSync(options.workspace, { recursive: true, force: true });
    },
  };
}

export function scratchDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function buildScriptAgent(
  calls: readonly ScriptCallSpec[],
  options: AgentOptions,
): Promise<ScriptAgent> {
  return buildFromTurns(toolTurns(calls.map(scriptCall)), options);
}

export function runTurn(
  agent: Agent,
  signal?: AbortSignal,
): Promise<AgentEvent[]> {
  return drain(agent.stream('run the script', { signal }));
}

/** Processes on this machine whose command line contains `marker`. */
export function processesMatching(marker: string): string[] {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
    encoding: 'utf8',
  });
  if (listing.status !== 0)
    throw new Error(`Cannot list processes: ${listing.stderr}`);
  return listing.stdout
    .split('\n')
    .filter((line) => line.includes(marker) && !line.includes('ps -A'));
}

/** Resolves once `predicate` holds, polling every 20 ms. */
export async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Collects confirmation requests without answering them. */
export function collectConfirmations(agent: Agent): {
  readonly requests: ToolConfirmation[];
  unsubscribe(): void;
} {
  const requests: ToolConfirmation[] = [];
  const unsubscribe = agent.tools.onConfirmationRequest((request) => {
    requests.push(request);
  });
  return { requests, unsubscribe };
}

export interface ScriptResponse {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly callCount: number;
  readonly partial: boolean;
  readonly completedCalls: ReadonlyArray<{
    readonly tool: string;
    readonly status: string;
  }>;
  readonly logs: readonly string[];
}

/** Every provider-visible tool response in model history. */
export function toolResponses(history: readonly IContent[]) {
  return history.flatMap((content) =>
    content.blocks.filter((block) => block.type === 'tool_response'),
  );
}

/**
 * The model-facing text of a tool response: `output` on success, `error` on
 * failure (the response's own `error` field is only a short failure marker).
 */
export function modelFacingText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null) {
    if ('output' in result)
      return String((result as { output: unknown }).output);
    if ('error' in result) return String((result as { error: unknown }).error);
  }
  return JSON.stringify(result);
}

/** Parses the single script response recorded for `callId`. */
export async function scriptResponse(
  agent: Agent,
  callId = 'script-call-1',
): Promise<ScriptResponse> {
  const responses = toolResponses(await agent.getHistory()).filter(
    (block) => block.callId === callId,
  );
  if (responses.length !== 1)
    throw new Error(
      `Expected one response for ${callId}, found ${responses.length}`,
    );
  const [response] = responses;
  const text = modelFacingText(response.result);
  const start = text.indexOf('{"ok"');
  if (start < 0) throw new Error(`No script result in response: ${text}`);
  return JSON.parse(text.slice(start)) as ScriptResponse;
}
