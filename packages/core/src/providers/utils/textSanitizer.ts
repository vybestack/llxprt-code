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

import type { DebugLogger } from '../../debug/index.js';

/**
 * Remove provider-specific thinking/reasoning markup from text.
 *
 * Strips <think>, <thinking>, and <analysis> tag blocks, replacing them with
 * a single space to preserve word spacing (prevents "these<think>...</think>5"
 * from becoming "these5"). Cleans up stray unmatched tags and collapses
 * extra whitespace only when reasoning tags were present.
 */
export function sanitizeProviderText(
  text: unknown,
  logger?: DebugLogger,
): string {
  if (text === null || text === undefined) {
    return '';
  }

  let str = typeof text === 'string' ? text : String(text);
  const beforeLen = str.length;
  const hadReasoningTags =
    /<(?:think|thinking|analysis)>|<\/(?:think|thinking|analysis)>/i.test(str);

  str = str.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  str = str.replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ');
  str = str.replace(/<analysis>[\s\S]*?<\/analysis>/gi, ' ');

  str = str.replace(/<\/?(?:think|thinking|analysis)>/gi, ' ');

  if (hadReasoningTags) {
    str = str.replace(/[ \t]+/g, ' ');
    str = str.replace(/\n{3,}/g, '\n\n');
    str = str.replace(/^[ \t]+/, '');
  }

  const afterLen = str.length;
  if (hadReasoningTags && afterLen !== beforeLen) {
    logger?.debug(() => `Stripped reasoning tags`, {
      beforeLen,
      afterLen,
    });
  }

  return str;
}
