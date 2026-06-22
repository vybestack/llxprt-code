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

import type OpenAI from 'openai';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { coerceMessageContentToString } from './OpenAIResponseParser.js';

export function extractSanitizedChunkText(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
): string {
  const choicesRuntime: unknown = chunk.choices;
  if (!Array.isArray(choicesRuntime)) {
    return '';
  }

  const choice: unknown = choicesRuntime[0];
  if (typeof choice !== 'object' || choice === null || !('delta' in choice)) {
    return '';
  }

  const deltaRuntime = choice.delta;
  if (
    typeof deltaRuntime !== 'object' ||
    deltaRuntime === null ||
    !('content' in deltaRuntime)
  ) {
    return '';
  }

  const deltaContent = coerceMessageContentToString(deltaRuntime.content);
  if (deltaContent === undefined || deltaContent === '') {
    return '';
  }
  return sanitizeProviderText(deltaContent);
}
