/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import type { HookLLMResponse } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import {
  AfterModelHookOutput,
  HookEventName,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

/** The pinned selection the provider is sending; owned and released by the send, not the hook. */
export interface SourceAfterModelRequest {
  readonly rows: () => ProviderRequestRows;
  readonly tools: ToolDeclaration[] | undefined;
  readonly signal?: AbortSignal;
}

export interface SourceAfterModelInput {
  readonly system: HookSystem;
  readonly request: SourceAfterModelRequest | undefined;
  readonly model: string;
  readonly response: Omit<HookLLMResponse, 'version'>;
  /** Mirrors the eager route, which omits an emptied restricted tool list. */
  readonly omitTools: boolean;
  readonly log: (message: string) => void;
}

/**
 * Fires AfterModel against the pinned selection. The hook sees the same request
 * rows the provider received, streamed from disk for the one invocation; its
 * output is released before this returns. Execution failures are non-blocking,
 * as on the eager route, and the surviving outputs of a partly failed event apply.
 */
export async function fireSourceAfterModelHook(
  input: SourceAfterModelInput,
): Promise<AfterModelHookOutput | undefined> {
  const { request } = input;
  if (request === undefined)
    throw new Error('AfterModel requires a request payload or source request');
  request.signal?.throwIfAborted();
  // No registered hook means no request context is opened for this chunk.
  if (
    input.system.getRegistry().getHooksForEvent(HookEventName.AfterModel)
      .length === 0
  )
    return undefined;
  const tools = request.tools;
  const hook = await input.system.fireAfterModelSnapshotEvent(
    {
      model: input.model,
      contents: request.rows(),
      ...(tools !== undefined && !input.omitTools ? { tools } : {}),
    },
    input.response,
    request.signal,
  );
  try {
    // Matches the eager route: outputs of commands that succeeded still apply
    // when a sibling command failed.
    if (!hook.success)
      input.log(
        `AfterModel hook failed (non-blocking): ${hook.errors.map((error) => error.message).join('; ')}`,
      );
    const output = hook.finalOutput;
    if (output === undefined) return undefined;
    const llmResponse = output.readLlmResponse();
    return new AfterModelHookOutput({
      ...(output.shouldStopExecution() ? { continue: false } : {}),
      ...(output.isBlockingDecision() ? { decision: 'block' } : {}),
      stopReason: output.getEffectiveReason(),
      systemMessage: output.readSystemMessage(),
      ...(llmResponse === undefined
        ? {}
        : { hookSpecificOutput: { llm_response: llmResponse } }),
    });
  } finally {
    hook.close();
  }
}
