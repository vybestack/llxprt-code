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

import type { IContent } from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';
import { HistoryToolNormalization } from './historyToolNormalization.js';
import { deepCloneWithoutCircularRefs } from './historyCloneUtils.js';

/**
 * Build a provider-ready content array from curated history and optional tail
 * contents. This runs the multi-step normalization pipeline:
 *   1. Split tool calls out of tool-speaker messages.
 *   2. Ensure every tool response has a matching tool call.
 *   3. Ensure every tool call has a matching tool response.
 *   4. Ensure tool responses are adjacent to their tool calls.
 *   5. Deep clone to remove circular references.
 */
export function buildProviderContent(
  curated: IContent[],
  tailContents: IContent[],
  logger: DebugLogger,
): IContent[] {
  const combined =
    tailContents.length > 0 ? [...curated, ...tailContents] : curated;

  // Defensive: if a tool-speaker message accidentally contains tool_call
  // blocks (e.g., cancellation history recorded as a single "user" Content
  // containing both functionCall + functionResponse parts), split them into
  // provider-compliant turns.
  const split =
    HistoryToolNormalization.splitToolCallsOutOfToolMessages(combined);

  // Ensure every tool response has a corresponding tool call for provider payloads
  const normalized = HistoryToolNormalization.ensureToolCallContinuity(
    split,
    logger,
  );

  // Ensure every tool call has some corresponding tool response in provider
  // payloads, even if the tool execution was interrupted or cancelled.
  // All providers require strict tool call/response matching - orphaned tool
  // calls cause 400 errors from Anthropic, Gemini, OpenAI, and others.
  const completed =
    HistoryToolNormalization.ensureToolResponseCompleteness(normalized);

  // All providers require strict tool adjacency: tool results must appear
  // directly after the assistant tool call message. Corrupted histories can
  // contain duplicate or out-of-order tool results, which will 400 on provider
  // switching. Normalize ordering and drop dupes.
  const ordered = HistoryToolNormalization.ensureToolResponseAdjacency(
    completed,
    logger,
  );

  // Deep clone to avoid circular references in tool call parameters
  // We need a clean copy that can be serialized
  return deepCloneWithoutCircularRefs(ordered);
}
