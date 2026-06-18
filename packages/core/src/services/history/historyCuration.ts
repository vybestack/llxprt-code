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

import { ContentValidation, type IContent } from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';
import {
  logAiMessageAnalysis,
  logExcludedAiMessage,
  logCurationSummary,
} from './curationDebugLogger.js';

/**
 * Analyze an AI content entry for curation, optionally logging debug details.
 */
export function analyzeAiContent(
  logger: DebugLogger,
  content: IContent,
  messageIndex: number,
): { hasValidContent: boolean } {
  const hasValidContent = ContentValidation.hasContent(content);
  logAiMessageAnalysis(logger, content, messageIndex, hasValidContent);
  return { hasValidContent };
}

/**
 * Build a curated history list (only valid, meaningful content).
 * Matches the behavior of extractCuratedHistory in chatSession.ts:
 * - Always includes user/human messages
 * - Always includes tool messages
 * - Only includes AI messages if they are valid (have content)
 */
export function buildCuratedHistory(
  logger: DebugLogger,
  history: readonly IContent[],
  isCompressing: boolean,
): IContent[] {
  // Wait if compression is in progress
  if (isCompressing) {
    logger.debug('getCurated called during compression - returning snapshot');
  }

  // Build the curated list without modifying history
  const curated: IContent[] = [];
  let excludedCount = 0;
  let aiMessagesAnalyzed = 0;
  let aiMessagesIncluded = 0;

  for (const content of history) {
    if (content.speaker === 'human' || content.speaker === 'tool') {
      // Always include user and tool messages
      curated.push(content);
    } else {
      aiMessagesAnalyzed++;
      const { hasValidContent } = analyzeAiContent(
        logger,
        content,
        aiMessagesAnalyzed,
      );

      if (hasValidContent) {
        curated.push(content);
        aiMessagesIncluded++;
      } else {
        excludedCount++;
        logExcludedAiMessage(logger);
      }
    }
  }

  logCurationSummary(logger, {
    totalHistory: history.length,
    curated,
    aiMessagesAnalyzed,
    aiMessagesIncluded,
    excludedCount,
    isCompressing,
  });

  return curated;
}
