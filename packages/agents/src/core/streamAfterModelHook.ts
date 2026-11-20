/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ModelOutput,
  ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
import type { PreparedRequest } from './streamRequestHelpers.js';
import {
  afterModelModifiedToChunk,
  afterModelBlockingToModelOutput,
} from './hookWireAdapter.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import {
  fireSourceAfterModelHook,
  type SourceAfterModelRequest,
} from './source-after-model-hook.js';

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
  iContent: IContent,
  requestPayload: PreparedRequest['requestPayload'] | undefined,
  chunk: ModelStreamChunk,
  hookRestrictedAllowedTools: string[] | undefined,
  sourceRequest: SourceAfterModelRequest | undefined,
  owner: HookExecutionOwner | undefined,
  model: string,
  logger: DebugLogger,
): Promise<ModelStreamChunk | undefined> {
  if (owner === undefined) return undefined;
  if (requestPayload !== undefined && owner.afterModel === undefined)
    return undefined;

  // Build the hook-visible IContent with restricted tool blocks filtered.
  const filteredBlocks = filterHookRestrictedBlocks(
    iContent.blocks,
    hookRestrictedAllowedTools,
  );
  const hookIContent = iContentFromBlocks(filteredBlocks, iContent.speaker);

  const response = {
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
  };
  const requestTools = requestPayload?.tools ?? sourceRequest?.tools;
  // A restricted selection that emptied the tool list is hidden from hooks.
  const omitTools =
    requestTools === undefined ||
    (requestTools.length === 0 && hookRestrictedAllowedTools !== undefined);
  const afterModelResult =
    requestPayload !== undefined
      ? await owner.afterModel?.(
          {
            model,
            contents: requestPayload.contents,
            ...(omitTools ? {} : { tools: requestTools }),
          },
          response,
          owner.signal,
        )
      : await fireSourceAfterModelHook({
          owner,
          request: sourceRequest,
          model,
          response,
          omitTools,
          log: (message) => logger.debug(() => message),
        });

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
