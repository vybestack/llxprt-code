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

import type { ThinkingBlock } from '../../services/history/IContent.js';
import type { DebugLogger } from '../../debug/index.js';

/**
 * Extract thinking content from <think>, <thinking>, or <analysis> tags
 * and return it as a ThinkingBlock. Returns null if no thinking tags found.
 *
 * Must be called BEFORE sanitizeProviderText which strips these tags.
 *
 * Handles two formats:
 * 1. Standard: <think>Full thinking paragraph here...</think>
 * 2. Fragmented (Synthetic API): <think>word</think><think>word</think>...
 *
 * For fragmented format, joins with spaces. For standard, joins with newlines.
 */
export function extractThinkTagsAsBlock(
  text: string,
  logger?: DebugLogger,
): ThinkingBlock | null {
  if (!text) {
    return null;
  }

  const thinkingParts: string[] = [];

  const thinkMatches = text.matchAll(/<think>([\s\S]*?)<\/think>/gi);
  for (const match of thinkMatches) {
    const content = match[1];
    if (content?.trim()) {
      thinkingParts.push(content.trim());
    }
  }

  const thinkingMatches = text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/gi);
  for (const match of thinkingMatches) {
    const content = match[1];
    if (content?.trim()) {
      thinkingParts.push(content.trim());
    }
  }

  const analysisMatches = text.matchAll(/<analysis>([\s\S]*?)<\/analysis>/gi);
  for (const match of analysisMatches) {
    const content = match[1];
    if (content?.trim()) {
      thinkingParts.push(content.trim());
    }
  }

  if (thinkingParts.length === 0) {
    return null;
  }

  const avgPartLength =
    thinkingParts.reduce((sum, p) => sum + p.length, 0) / thinkingParts.length;
  const isFragmented = thinkingParts.length > 5 && avgPartLength < 15;

  const combinedThought = isFragmented
    ? thinkingParts.join(' ')
    : thinkingParts.join('\n\n');

  logger?.debug(
    () => `Extracted thinking from tags: ${combinedThought.length} chars`,
    { tagCount: thinkingParts.length, isFragmented, avgPartLength },
  );

  return {
    type: 'thinking',
    thought: combinedThought,
    sourceField: 'think_tags',
    isHidden: false,
  };
}
