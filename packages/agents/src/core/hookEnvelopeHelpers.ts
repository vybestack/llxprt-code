/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260914-HOOKWIREV2 (issue #2624)
 *
 * Builders that assemble the v2 hook fire-site envelopes (core-owned
 * HookLLMRequest / HookLLMResponse minus `version`, which the HookSystem
 * stamps before dispatch). This is the neutral -> wire counterpart of
 * hookWireAdapter.ts (wire -> neutral). Extracted from
 * DirectMessageProcessor so the envelope shape is named once and the
 * processor stays under its source-size gate.
 */

import type {
  HookLLMRequest,
  HookLLMResponse,
} from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  toolDeclarationsFromLegacyToolset,
  type LegacyToolsetLike,
  type ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Request envelope for the BeforeToolSelection fire site: the candidate
 * tool declarations only — selection happens before any contents exist.
 */
export function toolSelectionRequest(
  model: string,
  tools: LegacyToolsetLike,
): Omit<HookLLMRequest, 'version'> {
  return {
    model,
    contents: [],
    tools: toolDeclarationsFromLegacyToolset(tools),
  };
}

/**
 * Request envelope for the BeforeModel fire site on the direct-message
 * path: replacement contents plus tool declarations when the request
 * carries tools, with the tools key present-but-undefined otherwise
 * (preserves the pre-extraction literal shape hooks may observe).
 */
export function beforeModelRequestEnvelope(
  model: string,
  contents: IContent[],
  tools: LegacyToolsetLike | undefined,
): Omit<HookLLMRequest, 'version'> {
  return {
    model,
    contents,
    tools:
      tools !== undefined && tools.length > 0
        ? toolDeclarationsFromLegacyToolset(tools)
        : undefined,
  };
}

/**
 * Request envelope for the AfterModel fire site: the conversation as the
 * model saw it, with the tools key included only when the request carried
 * a non-empty toolset.
 */
export function afterModelRequestEnvelope(
  model: string,
  contents: IContent[] | undefined,
  tools: unknown,
): Omit<HookLLMRequest, 'version'> {
  return {
    model,
    contents: contents ?? [],
    ...(Array.isArray(tools) && tools.length > 0
      ? { tools: toolDeclarationsFromLegacyToolset(tools) }
      : {}),
  };
}

/**
 * Response envelope for the AfterModel fire site: the hook-visible content
 * plus the terminal fields, each included only when the output carried it.
 */
export function afterModelResponseEnvelope(
  content: IContent,
  output: Pick<ModelOutput, 'finishReason' | 'rawStopReason' | 'usage'>,
): Omit<HookLLMResponse, 'version'> {
  return {
    content,
    ...(output.finishReason !== undefined
      ? { finishReason: output.finishReason }
      : {}),
    ...(output.rawStopReason !== undefined
      ? { rawStopReason: output.rawStopReason }
      : {}),
    ...(output.usage !== undefined ? { usage: output.usage } : {}),
  };
}
