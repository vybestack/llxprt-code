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
 * Map OpenAI finish_reason to the stopReason format expected by MessageConverter.
 * OpenAI values: stop, length, tool_calls, content_filter, function_call
 * OpenAI Responses API statuses: completed, incomplete, failed
 * MessageConverter expects: end_turn, max_tokens, stop_sequence, tool_use, etc.
 */
export function mapFinishReasonToStopReason(
  finishReason: string | null | undefined,
): string | undefined {
  if (!finishReason) return undefined;
  const mapping: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    content_filter: 'content_filter',
    function_call: 'tool_use',
    // OpenAI Responses API terminal statuses
    completed: 'end_turn',
    incomplete: 'max_tokens',
    failed: 'end_turn',
  };
  return mapping[finishReason] ?? finishReason;
}
