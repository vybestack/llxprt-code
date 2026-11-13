/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  iContentFromBlocks,
  type ModelOutput,
  type ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  AgentExecutionBlockedError,
  AgentExecutionStoppedError,
} from './chatSession.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import {
  afterModelBlockingToModelOutput,
  afterModelModifiedToChunk,
} from './hookWireAdapter.js';
import type { PreparedRequest } from './streamRequestHelpers.js';

/** Everything the AfterModel hook needs to see about one streamed chunk. */
interface AfterModelChunk {
  readonly model: string;
  readonly iContent: IContent;
  readonly requestPayload: PreparedRequest['requestPayload'] | undefined;
  readonly chunk: ModelStreamChunk;
  readonly hookRestrictedAllowedTools: string[] | undefined;
  readonly owner?: HookExecutionOwner;
}

/**
 * Process AfterModel hook for a single streamed chunk.
 *
 * Returns a neutral ModelStreamChunk when the hook modifies the response,
 * or `undefined` for passthrough (yield the original chunk).
 *
 * Throws AgentExecutionStoppedError / AgentExecutionBlockedError on
 * stop/block decisions.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-002.6
 */
export async function processAfterModelHook(
  input: AfterModelChunk,
): Promise<ModelStreamChunk | undefined> {
  const { model, iContent, requestPayload, chunk } = input;
  const { hookRestrictedAllowedTools, owner } = input;
  if (owner?.afterModel === undefined) return undefined;

  // Build the hook-visible IContent with restricted tool blocks filtered.
  const filteredBlocks = filterHookRestrictedBlocks(
    iContent.blocks,
    hookRestrictedAllowedTools,
  );
  const hookIContent = iContentFromBlocks(filteredBlocks, iContent.speaker);

  const afterModelResult = await owner.afterModel(
    {
      model,
      contents: requestPayload?.contents ?? [],
      ...(requestPayload?.tools !== undefined &&
      (requestPayload.tools.length > 0 ||
        hookRestrictedAllowedTools === undefined)
        ? {
            tools: requestPayload.tools,
          }
        : {}),
    },
    {
      content: hookIContent,
      // finishReason/rawStopReason live only on terminal chunks; toModelStreamChunk
      // already lifted them onto the chunk when the provider emitted them.
      ...(chunk.finishReason !== undefined
        ? { finishReason: chunk.finishReason }
        : {}),
      ...(chunk.rawStopReason !== undefined
        ? { rawStopReason: chunk.rawStopReason }
        : {}),
      ...(chunk.usage !== undefined ? { usage: chunk.usage } : {}),
    },
    owner.signal,
  );

  if (afterModelResult?.shouldStopExecution() === true) {
    throw new AgentExecutionStoppedError(
      afterModelResult.getEffectiveReason(),
      afterModelResult.systemMessage,
    );
  }

  if (afterModelResult?.isBlockingDecision() === true) {
    throwAfterModelBlocked(afterModelResult, chunk);
  }

  // MODIFY branch: convert hook's response to neutral chunk.
  const modifiedResponse = afterModelResult?.getModifiedResponse();
  if (modifiedResponse) {
    return afterModelModifiedToChunk(modifiedResponse, chunk);
  }

  return undefined;
}

/**
 * BLOCK branch of the AfterModel hook: build a ModelOutput from the
 * hook-modified response or the current chunk, carry the block reason
 * text, and throw AgentExecutionBlockedError.
 *
 * P13: neutral — no synthetic GenerateContentResponse is built here.
 */
function throwAfterModelBlocked(
  afterModelResult: AfterModelHookOutput,
  chunk: ModelStreamChunk,
): never {
  const effectiveReason = afterModelResult.getEffectiveReason();
  const modifiedResponse = afterModelResult.getModifiedResponse();
  const blockedOutput: ModelOutput = modifiedResponse
    ? (afterModelModifiedToChunk(modifiedResponse, chunk) ?? { ...chunk })
    : { ...chunk };
  // P13: Use the neutral blocking adapter for the block reason text.
  const finalBlockedOutput = afterModelBlockingToModelOutput(
    effectiveReason,
    blockedOutput,
  );
  throw new AgentExecutionBlockedError(
    effectiveReason,
    finalBlockedOutput,
    afterModelResult.systemMessage,
  );
}
