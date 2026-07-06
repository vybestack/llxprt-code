/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Neutral model output/stream-chunk envelope anchored on IContent.
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005
 * @pseudocode lines 10-52
 */

import type { IContent, UsageStats } from '../services/history/IContent.js';
import type { ToolCallRequest } from './toolCall.js';
import type { CanonicalFinishReason } from './finishReasons.js';
import {
  isCanonicalFinishReason,
  OPENAI_FINISH_MAP,
  ANTHROPIC_STOP_MAP,
  GEMINI_FINISH_MAP,
} from './finishReasons.js';
import { isRecord } from './jsonSchema.js';

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.1
 * @pseudocode line 10
 */
export interface HookRestrictions {
  allowedToolNames?: string[];
  filteredRestrictedCalls?: ToolCallRequest[];
}

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.1
 * @pseudocode lines 11-13
 */
export interface ModelOutput {
  content: IContent;
  finishReason?: CanonicalFinishReason;
  rawStopReason?: string;
  usage?: UsageStats;
  responseId?: string;
  hookRestrictions?: HookRestrictions;
  providerMetadata?: Record<string, unknown>;
}

/**
 * Structurally identical to {@link ModelOutput}; kept as a separate named
 * alias so call sites distinguish streaming deltas from final accumulations.
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.2
 * @pseudocode line 14
 */
export type ModelStreamChunk = ModelOutput;

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.1
 * @pseudocode lines 15-16
 */
export function emptyModelOutput(
  speaker: 'human' | 'ai' | 'tool' = 'ai',
): ModelOutput {
  return { content: { speaker, blocks: [] } };
}

/**
 * Pure accumulation: returns new top-level objects, never mutates acc or
 * chunk. Nested block objects are shared by reference (shallow-copy only).
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.3
 * @pseudocode lines 17-31
 */
export function accumulateModelStreamChunk(
  acc: ModelOutput,
  chunk: ModelStreamChunk,
): ModelOutput {
  const content: IContent = {
    speaker: acc.content.speaker,
    blocks: [...acc.content.blocks, ...chunk.content.blocks],
  };

  if (acc.content.metadata || chunk.content.metadata) {
    // Shallow merge only; nested objects (providerMetadata, usage) are
    // shared by reference. Callers must not mutate them.
    content.metadata = {
      ...acc.content.metadata,
      ...chunk.content.metadata,
    };
  }

  const result: ModelOutput = { content };

  const finishReason = chunk.finishReason ?? acc.finishReason;
  if (finishReason !== undefined) {
    result.finishReason = finishReason;
  }

  const rawStopReason = chunk.rawStopReason ?? acc.rawStopReason;
  if (rawStopReason !== undefined) {
    result.rawStopReason = rawStopReason;
  }

  const usage = chunk.usage ?? acc.usage;
  if (usage !== undefined) {
    // Defensive copy: last-write-wins semantics (whole-object replacement),
    // but the copied object is not shared with the input chunk/acc.
    result.usage = { ...usage };
  }

  const responseId = chunk.responseId ?? acc.responseId;
  if (responseId !== undefined) {
    result.responseId = responseId;
  }

  const hookRestrictions = chunk.hookRestrictions ?? acc.hookRestrictions;
  if (hookRestrictions !== undefined) {
    // Defensive copy: top-level object is copied so callers cannot mutate the
    // original acc/chunk. Nested arrays (allowedToolNames, filteredRestrictedCalls)
    // are shared by reference — callers must not mutate them.
    result.hookRestrictions = { ...hookRestrictions };
  }

  // Note: shallow merge — top-level keys are copied, but nested object/array
  // values within providerMetadata are shared by reference with the inputs.
  if (acc.providerMetadata || chunk.providerMetadata) {
    result.providerMetadata = {
      ...acc.providerMetadata,
      ...chunk.providerMetadata,
    };
  }

  return result;
}

/**
 * Derives {@link ToolCallRequest}[] from tool_call blocks in content.
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.4
 * @pseudocode lines 32-36
 */
export function getToolCalls(output: ModelOutput): ToolCallRequest[] {
  const result: ToolCallRequest[] = [];

  for (const block of output.content.blocks) {
    if (block.type !== 'tool_call') {
      continue;
    }

    const args = isRecord(block.parameters) ? { ...block.parameters } : {};

    const call: ToolCallRequest = {
      id: block.id,
      name: block.name,
      args,
    };
    result.push(call);
  }

  return result;
}

/**
 * Maps streamed IContent metadata (stopReason/finishReason/usage/id) into a
 * neutral {@link ModelStreamChunk}. stopReason is preferred (provider-native).
 *
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.5
 * @pseudocode lines 38-48
 */
export function toModelStreamChunk(icontent: IContent): ModelStreamChunk {
  const meta = icontent.metadata;

  const result: ModelStreamChunk = { content: icontent };

  const raw = meta?.stopReason ?? meta?.finishReason;
  if (raw !== undefined) {
    result.rawStopReason = raw;
    result.finishReason = isCanonicalFinishReason(raw)
      ? raw
      : tryAllMappers(raw);
  }

  if (meta?.usage) {
    // Defensive copy so callers cannot mutate the original IContent metadata.
    result.usage = { ...meta.usage };
  }

  if (meta?.id) {
    result.responseId = meta.id;
  }

  return result;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-005.5
 * @pseudocode lines 49-52
 */
function tryAllMappers(raw: string): CanonicalFinishReason {
  // Priority: OpenAI → Anthropic → Gemini. The maps have no conflicting keys
  // today, so the order does not affect results for any known stop reason.
  // hasOwnProperty is used (rather than `??`) to correctly handle keys whose
  // mapped value could be falsy, though all values here are non-empty strings.
  if (Object.prototype.hasOwnProperty.call(OPENAI_FINISH_MAP, raw)) {
    return OPENAI_FINISH_MAP[raw];
  }
  if (Object.prototype.hasOwnProperty.call(ANTHROPIC_STOP_MAP, raw)) {
    return ANTHROPIC_STOP_MAP[raw];
  }
  if (Object.prototype.hasOwnProperty.call(GEMINI_FINISH_MAP, raw)) {
    return GEMINI_FINISH_MAP[raw];
  }
  return 'other';
}
