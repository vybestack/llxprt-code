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

/**
 * Get history within a token limit, keeping the most recent messages.
 * Works backwards from the end to preserve recency.
 */
export function getWithinTokenLimit(
  history: readonly IContent[],
  maxTokens: number,
  countTokensFn: (content: IContent) => number,
): IContent[] {
  const result: IContent[] = [];
  let totalTokens = 0;

  // Work backwards to keep most recent messages
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i];
    const tokens = countTokensFn(content);

    if (totalTokens + tokens <= maxTokens) {
      result.unshift(content);
      totalTokens += tokens;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Summarize older history to fit within token limits.
 * Returns the new history array with a summary prepended to the kept tail.
 * Returns null when no summarization is needed.
 */
export async function summarizeOldHistory(
  history: readonly IContent[],
  keepRecentCount: number,
  summarizeFn: (contents: IContent[]) => Promise<IContent>,
): Promise<IContent[] | null> {
  if (history.length <= keepRecentCount) {
    return null;
  }

  const toSummarize = history.slice(0, -keepRecentCount);
  const toKeep = history.slice(-keepRecentCount);

  const summary = await summarizeFn(toSummarize);
  return [summary, ...toKeep];
}
