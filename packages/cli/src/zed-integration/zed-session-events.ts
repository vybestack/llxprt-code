/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  EmojiFilter,
  type ContractPart,
  type FilterConfiguration,
  getErrorStatus,
} from '@vybestack/llxprt-code-core';
import { handleZedAgentEvent } from './zed-agent-event-handler.js';
import { StreamBatcher } from './zed-stream-batcher.js';
import type { ZedPathResolver } from './zed-path-resolver.js';
import { TerminalManager } from './zed-terminal-manager.js';

type SendUpdateFn = (update: acp.SessionUpdate) => Promise<void>;
type SendUsageFn = (
  usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
) => Promise<void>;
type HandleConfirmationFn = (
  event: Extract<AgentEvent, { type: 'tool-confirmation' }>,
) => Promise<void>;

export interface SessionStreamDeps {
  readonly agent: Agent;
  readonly terminals: TerminalManager | null;
  readonly sendUpdate: SendUpdateFn;
  readonly sendUsage: SendUsageFn;
  readonly handleConfirmation: HandleConfirmationFn;
  readonly isPromptStale: (
    promptGeneration: number,
    pendingSend: AbortController,
  ) => boolean;
  readonly maxTurns: number;
}

/**
 * Consumes the agent event stream, forwarding each event to the Zed handler
 * and managing terminal lifecycle for shell tool calls.
 */
export async function consumeAgentStream(
  deps: SessionStreamDeps,
  parts: readonly ContractPart[],
  pendingSend: AbortController,
  promptId: string,
  promptGeneration: number,
  batcher: StreamBatcher,
): Promise<acp.StopReason | null> {
  const eventStream = deps.agent.stream(parts, {
    signal: pendingSend.signal,
    promptId,
    maxTurns: deps.maxTurns,
  });
  let terminalStopReason: acp.StopReason | null = null;
  try {
    for await (const event of eventStream) {
      const result = await processStreamEvent(
        event,
        deps,
        batcher,
        promptGeneration,
        pendingSend,
      );
      if (result === 'cancelled') return 'cancelled';
      if (result !== null) terminalStopReason = result;
    }
    return terminalStopReason;
  } finally {
    if (deps.terminals !== null) {
      await deps.terminals.settleAll();
    }
  }
}

async function processStreamEvent(
  event: AgentEvent,
  deps: SessionStreamDeps,
  batcher: StreamBatcher,
  promptGeneration: number,
  pendingSend: AbortController,
): Promise<acp.StopReason | null | 'cancelled'> {
  if (deps.isPromptStale(promptGeneration, pendingSend)) {
    return event.type === 'done' ? 'cancelled' : null;
  }
  if (
    event.type === 'tool-call' &&
    deps.terminals !== null &&
    TerminalManager.isShellToolCall(
      event.call,
      deps.agent.tools.get(event.call.name)?.kind,
    )
  ) {
    await deps.terminals.handleToolCall(event.call);
  }
  const stopReason = await handleZedAgentEvent(event, batcher, {
    sendUpdate: deps.sendUpdate,
    sendUsage: deps.sendUsage,
    handleConfirmation: deps.handleConfirmation,
    resolveToolKind: (toolName) => deps.agent.tools.get(toolName)?.kind,
  });
  if (event.type === 'tool-result' && deps.terminals !== null) {
    await deps.terminals.releaseTerminal(event.result.id);
  }
  return stopReason;
}

export interface PromptTurnDeps {
  readonly pathResolver: ZedPathResolver;
  readonly emojiFilterMode: FilterConfiguration['mode'];
  readonly streamDeps: SessionStreamDeps;
}

export async function runPromptTurn(
  deps: PromptTurnDeps,
  params: acp.PromptRequest,
  pendingSend: AbortController,
  promptId: string,
  promptGeneration: number,
): Promise<acp.PromptResponse> {
  let parts: ContractPart[];
  try {
    parts = await deps.pathResolver.resolvePrompt(
      params.prompt,
      pendingSend.signal,
    );
  } catch (error) {
    if (
      pendingSend.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return { stopReason: 'cancelled' };
    }
    throw error;
  }
  const batcher = new StreamBatcher(
    new EmojiFilter({ mode: deps.emojiFilterMode }),
    (u) => deps.streamDeps.sendUpdate(u),
  );
  let terminalStopReason: acp.StopReason | null = null;
  try {
    terminalStopReason = await consumeAgentStream(
      deps.streamDeps,
      parts,
      pendingSend,
      promptId,
      promptGeneration,
      batcher,
    );
  } catch (error) {
    if (getErrorStatus(error) === 429) {
      await safeFlush(batcher);
      throw new acp.RequestError(429, 'Rate limit exceeded. Try again later.');
    }
    if (
      pendingSend.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      await safeFlush(batcher);
      return { stopReason: 'cancelled' };
    }
    await safeFlush(batcher);
    throw error;
  } finally {
    batcher.dispose();
  }
  if (pendingSend.signal.aborted && terminalStopReason !== 'cancelled') {
    return { stopReason: 'cancelled' };
  }
  if (terminalStopReason !== null) {
    return { stopReason: terminalStopReason };
  }
  return { stopReason: 'end_turn' };
}

async function safeFlush(batcher: StreamBatcher): Promise<void> {
  try {
    await batcher.flush();
  } catch {
    // Swallow flush errors so the original error from consumeAgentStream
    // is not masked by a secondary flush failure.
  }
}
