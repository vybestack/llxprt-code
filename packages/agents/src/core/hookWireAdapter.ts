/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P07
 * @plan PLAN-20260914-HOOKWIREV2 (issue #2624)
 * @requirement:REQ-002.6
 *
 * The SINGLE named boundary module where the hook JSON-wire shape
 * (core-owned HookLLMResponse) is converted to neutral agents types. This is
 * the ONLY place in agents where the hook wire shape is read for the purpose
 * of producing neutral ModelStreamChunk values.
 *
 * The v2 hook wire payload is already neutral: content is an IContent that
 * passes through by reference (tool_call/tool_response/thinking blocks
 * preserved verbatim), finishReason is the canonical value, and usage is
 * neutral UsageStats. No provider vocabulary is translated here — hooks are
 * a trusted extension seam (#2624).
 */

import type { HookLLMResponse } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Merge a v2 hook response payload onto a base chunk/output. The hook's
 * content replaces the base content directly; optional finishReason /
 * rawStopReason / usage fields override only when the hook supplied them.
 */
function withHookResponseFields<T extends ModelOutput>(
  base: T,
  response: HookLLMResponse,
): T {
  const result: T = { ...base, content: response.content };
  if (response.usage !== undefined) {
    result.usage = response.usage;
  }
  if (response.finishReason !== undefined) {
    result.finishReason = response.finishReason;
  }
  if (response.rawStopReason !== undefined) {
    result.rawStopReason = response.rawStopReason;
  }
  return result;
}

/**
 * Maps a hook-modified v2 response payload to a neutral ModelStreamChunk.
 *
 * Called from StreamProcessor._processAfterModelHook when the AfterModel
 * hook returns a MODIFY decision. `ModelStreamChunk` is an alias of
 * `ModelOutput`, so this single mapper also serves the direct
 * (non-streaming) path in DirectMessageProcessor._applyAfterModelResult.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P07
 * @requirement:REQ-002.6
 * @pseudocode stream-processor-neutral.md lines 16-19
 *
 * @param modified - The hook-modified v2 response (may be undefined if hook did not modify)
 * @param base - The base neutral chunk to derive optional fields from
 * @returns A neutral ModelStreamChunk reflecting the hook modification, or undefined if not modified
 */
export function afterModelModifiedToChunk(
  modified: HookLLMResponse | undefined,
  base: ModelStreamChunk,
): ModelStreamChunk | undefined {
  if (modified === undefined) {
    return undefined;
  }

  return withHookResponseFields(base, modified);
}

/**
 * Maps a before-model blocking v2 response to a neutral ModelOutput.
 *
 * Used by DirectMessageProcessor when a BeforeModel hook blocks with a
 * synthetic response. The hook's content passes through directly; the block
 * reason text is the fallback when the synthetic response carries no blocks.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
 * @pseudocode directmessageprocessor-neutral.md lines 20-22
 *
 * @param reason - The effective block reason (may be undefined)
 * @param synthetic - The hook-supplied synthetic v2 response
 * @returns A neutral ModelOutput carrying the hook content or the block reason
 */
export function beforeModelBlockingToModelOutput(
  reason: string | undefined,
  synthetic: HookLLMResponse,
): ModelOutput {
  const result: ModelOutput = {
    content:
      synthetic.content.blocks.length > 0
        ? synthetic.content
        : {
            speaker: 'ai',
            blocks: [{ type: 'text', text: reason ?? 'Execution blocked' }],
          },
  };

  if (synthetic.usage !== undefined) {
    result.usage = synthetic.usage;
  }
  if (synthetic.finishReason !== undefined) {
    result.finishReason = synthetic.finishReason;
  }
  if (synthetic.rawStopReason !== undefined) {
    result.rawStopReason = synthetic.rawStopReason;
  }

  return result;
}

/**
 * Maps an AfterModel BLOCKING decision to a neutral ModelOutput.
 *
 * Used by StreamProcessor's streaming AfterModel BLOCK branch. Builds a
 * neutral ModelOutput carrying the block reason text, replacing the old
 * synthetic GenerateContentResponse path.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-002.6
 * @pseudocode stream-processor-neutral.md lines 20-22
 *
 * @param reason - The effective block reason
 * @param base - The base neutral chunk/output to derive speaker/usage from
 * @returns A neutral ModelOutput carrying the block reason
 */
export function afterModelBlockingToModelOutput(
  reason: string | undefined,
  base: ModelOutput,
): ModelOutput {
  return {
    ...base,
    content: {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: reason ?? 'Execution blocked by AfterModel hook',
        },
      ],
    },
  };
}
