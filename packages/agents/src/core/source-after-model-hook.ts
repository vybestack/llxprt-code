/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { HookModelSnapshotRequest } from '@vybestack/llxprt-code-core/hooks/hookSnapshotAggregator.js';
import type { HookLLMResponse } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

/** The pinned selection the provider is sending; owned and released by the send, not the hook. */
export interface SourceAfterModelRequest {
  readonly rows: () => ProviderRequestRows;
  readonly tools: ToolDeclaration[] | undefined;
  readonly signal?: AbortSignal;
}

export interface SourceAfterModelInput {
  readonly owner: HookExecutionOwner;
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
  const tools = request.tools;
  const openRows = request.rows;
  let pinnedRows: ProviderRequestRows | undefined;
  // The owner decides whether any hook runs; the rows are opened only on first
  // read, so a call with no registered AfterModel hook never touches them.
  const hookRequest: HookModelSnapshotRequest = {
    model: input.model,
    get contents(): ProviderRequestRows {
      pinnedRows ??= openRows();
      return pinnedRows;
    },
    ...(tools !== undefined && !input.omitTools ? { tools } : {}),
  };
  const hook = await input.owner.afterModelSnapshot?.(
    hookRequest,
    input.response,
    request.signal,
  );
  // The owner yields nothing when hooks are disabled or none is registered.
  if (hook === undefined) return undefined;
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
