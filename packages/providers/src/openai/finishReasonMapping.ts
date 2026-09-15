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

import type { FinishInfo } from '@vybestack/llxprt-code-core/llm-types/finishReasons.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:providers:openai:finish-reason');

const finishReasons: ReadonlyMap<string, FinishInfo['finishReason']> = new Map([
  ['stop', 'stop'],
  ['length', 'max_tokens'],
  ['tool_calls', 'tool_calls'],
  ['tool-calls', 'tool_calls'],
  ['function_call', 'tool_calls'],
  ['content_filter', 'safety'],
  ['content-filter', 'safety'],
  ['refusal', 'refusal'],
  ['completed', 'stop'],
  ['incomplete', 'max_tokens'],
  ['failed', 'error'],
]);

/** Maps provider-native terminal reasons while retaining diagnostic detail. */
export function mapFinishReason(rawStopReason: string): FinishInfo {
  const mapped = finishReasons.get(rawStopReason);
  if (mapped === undefined) {
    logger.warn(() => `[stream:finish-reason] unmapped provider finishReason`, {
      rawStopReason,
    });
  }
  const result: FinishInfo = { finishReason: mapped ?? 'other', rawStopReason };
  logger.debug(
    () => `[stream:finish-reason] mapped provider finishReason`,
    result,
  );
  return result;
}
