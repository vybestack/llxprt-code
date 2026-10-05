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

/** The row-wise inclusion rule shared by eager and journal-backed reads. */
export function isCuratedContent(content: IContent): boolean {
  return (
    content.speaker === 'human' ||
    content.speaker === 'tool' ||
    ContentValidation.hasContent(content)
  );
}

/**
 * Analyze an AI content entry for curation, optionally logging debug details.
 */
export function analyzeAiContent(
  logger: DebugLogger,
  content: IContent,
  messageIndex: number,
): { hasValidContent: boolean } {
  const hasValidContent = isCuratedContent(content);
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
  const diagnostics = new CurationDiagnostics();
  for (const content of history) {
    if (diagnostics.include(logger, content)) curated.push(content);
  }
  logCurationSummary(logger, { ...diagnostics, isCompressing });

  return curated;
}

class CurationDiagnostics {
  totalHistory = 0;
  curatedCount = 0;
  humanMessages = 0;
  toolMessages = 0;
  toolCallsInCurated = 0;
  toolResponsesInCurated = 0;
  aiMessagesAnalyzed = 0;
  aiMessagesIncluded = 0;
  excludedCount = 0;

  include(logger: DebugLogger, content: IContent): boolean {
    this.totalHistory++;
    if (content.speaker !== 'human' && content.speaker !== 'tool') {
      this.aiMessagesAnalyzed++;
      const { hasValidContent } = analyzeAiContent(
        logger,
        content,
        this.aiMessagesAnalyzed,
      );
      if (!hasValidContent) {
        this.excludedCount++;
        logExcludedAiMessage(logger);
        return false;
      }
      this.aiMessagesIncluded++;
    }
    this.curatedCount++;
    if (content.speaker === 'human') this.humanMessages++;
    if (content.speaker === 'tool') this.toolMessages++;
    for (const block of content.blocks) {
      if (block.type === 'tool_call') this.toolCallsInCurated++;
      if (block.type === 'tool_response') this.toolResponsesInCurated++;
    }
    return true;
  }
}

export async function* streamCuratedProviderHistory(
  logger: DebugLogger,
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  isCompressing: boolean,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  if (isCompressing)
    logger.debug('getCurated called during compression - returning snapshot');
  const diagnostics = new CurationDiagnostics();
  for await (const row of rows) {
    signal?.throwIfAborted();
    if (diagnostics.include(logger, row)) yield row;
  }
  logCurationSummary(logger, { ...diagnostics, isCompressing });
}
