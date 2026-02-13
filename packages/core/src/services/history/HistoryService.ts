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

import {
  type IContent,
  ContentValidation,
  type ToolCallBlock,
  type ToolResponseBlock,
  type TextBlock,
} from './IContent.js';
import { EventEmitter } from 'events';
import { type ITokenizer } from '../../providers/tokenizers/ITokenizer.js';
import { OpenAITokenizer } from '../../providers/tokenizers/OpenAITokenizer.js';
import { AnthropicTokenizer } from '../../providers/tokenizers/AnthropicTokenizer.js';
import { type TokensUpdatedEvent } from './HistoryEvents.js';
import { DebugLogger } from '../../debug/index.js';
import { randomUUID } from 'crypto';
import { canonicalizeToolCallId } from './canonicalToolIds.js';
import { estimateTokens as estimateTextTokens } from '../../utils/toolOutputLimiter.js';
import type { DensityResult } from '../../core/compression/types.js';
import { CompressionStrategyError } from '../../core/compression/types.js';

/**
 * Typed EventEmitter for HistoryService events
 */
interface HistoryServiceEventEmitter {
  on(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
  emit(event: 'tokensUpdated', eventData: TokensUpdatedEvent): boolean;
  off(
    event: 'tokensUpdated',
    listener: (eventData: TokensUpdatedEvent) => void,
  ): this;
}

/**
 * Configuration for compression behavior
 */
export interface CompressionConfig {
  orphanTimeoutMs: number; // Time before considering a call orphaned
  orphanMessageDistance: number; // Messages before considering orphaned
  pendingGracePeriodMs: number; // Grace period for pending calls
  minMessagesForCompression: number; // Minimum messages before compression
}

/**
 * Service for managing conversation history in a provider-agnostic way.
 * All history is stored as IContent. Providers are responsible for converting
 * to/from their own formats.
 */
export class HistoryService
  extends EventEmitter
  implements HistoryServiceEventEmitter
{
  private history: IContent[] = [];
  private totalTokens: number = 0;
  private baseTokenOffset: number = 0;
  private tokenizerCache = new Map<string, ITokenizer>();
  private tokenizerLock: Promise<void> = Promise.resolve();
  private logger = new DebugLogger('llxprt:history:service');

  // Compression state and queue
  private isCompressing: boolean = false;
  private pendingOperations: Array<() => void> = [];

  /**
   * Get or create tokenizer for a specific model
   */
  private getTokenizerForModel(modelName: string): ITokenizer {
    if (this.tokenizerCache.has(modelName)) {
      return this.tokenizerCache.get(modelName)!;
    }

    let tokenizer: ITokenizer;
    if (modelName.includes('claude') || modelName.includes('anthropic')) {
      tokenizer = new AnthropicTokenizer();
    } else if (
      modelName.includes('gpt') ||
      modelName.includes('openai') ||
      modelName.includes('o1') ||
      modelName.includes('o3')
    ) {
      tokenizer = new OpenAITokenizer();
    } else {
      // Default to OpenAI tokenizer for Gemini and other models (tiktoken is pretty universal)
      tokenizer = new OpenAITokenizer();
    }

    this.tokenizerCache.set(modelName, tokenizer);
    return tokenizer;
  }

  /**
   * Generate a new canonical history tool ID.
   * Format: hist_tool_<hash>
   */
  generateHistoryId(
    turnKey: string,
    callIndex: number,
    providerName?: string,
    rawId?: string,
    toolName?: string,
  ): string {
    return canonicalizeToolCallId({
      providerName,
      rawId,
      toolName,
      turnKey,
      callIndex,
    });
  }

  /**
   * Get a callback suitable for passing into converters
   * which will generate normalized history IDs on demand.
   */
  getIdGeneratorCallback(turnKey?: string): () => string {
    let callIndex = 0;
    const stableTurnKey = turnKey ?? this.generateTurnKey();
    return () => this.generateHistoryId(stableTurnKey, callIndex++);
  }

  generateTurnKey(): string {
    return `turn_${randomUUID()}`;
  }

  /**
   * Get the current total token count including base offset (system prompt).
   *
   * This value is used for compression threshold calculations and should always
   * reflect the total context size that will be sent to the API.
   *
   * @returns baseTokenOffset + totalTokens (history tokens)
   */
  getTotalTokens(): number {
    return this.baseTokenOffset + this.totalTokens;
  }

  getBaseTokenOffset(): number {
    return this.baseTokenOffset;
  }

  async estimateTokensForText(
    text: string,
    modelName: string = 'gpt-4.1',
  ): Promise<number> {
    if (!text) {
      return 0;
    }

    try {
      const tokenizer = this.getTokenizerForModel(modelName);
      return await tokenizer.countTokens(text, modelName);
    } catch (error) {
      this.logger.debug(
        'Error counting tokens for raw text, using fallback:',
        error,
      );
      return this.simpleTokenEstimateForText(text);
    }
  }

  /**
   * Set a base offset that is always included in the total token count.
   * Useful for accounting for system prompts or other fixed overhead.
   *
   * The system prompt token count should be set once at chat start using this method.
   * This offset is included in getTotalTokens() to ensure compression threshold
   * calculations account for the full context size (system prompt + history).
   *
   * NOTE: The system prompt itself is NEVER compressed - only conversation history
   * returned by getCurated() is subject to compression.
   *
   * @param offset - Number of tokens in the system prompt or fixed overhead
   */
  setBaseTokenOffset(offset: number): void {
    const normalized = Math.max(0, Math.floor(offset));
    const delta = normalized - this.baseTokenOffset;
    this.baseTokenOffset = normalized;

    if (delta !== 0) {
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: delta,
        contentId: null,
      });
    }
  }

  /**
   * Sync the total token count to match actual prompt tokens from a provider.
   * This adjusts the baseTokenOffset so estimates align with the real count.
   */
  syncTotalTokens(actualTotal: number): void {
    if (!Number.isFinite(actualTotal)) {
      this.logger.debug('Skipping syncTotalTokens for non-finite value', {
        actualTotal,
      });
      return;
    }

    const normalized = Math.max(0, Math.floor(actualTotal));

    // Ensure sync happens after any pending token estimation updates.
    this.tokenizerLock = this.tokenizerLock.then(() => {
      const currentTotal = this.getTotalTokens();
      const drift = normalized - currentTotal;

      if (drift === 0) {
        return;
      }

      this.baseTokenOffset += drift;

      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: drift,
        contentId: null,
      });
    });
  }

  /**
   * Add content to the history
   * Note: We accept all content including empty responses for comprehensive history.
   * Filtering happens only when getting curated history.
   */
  add(content: IContent, modelName?: string): void {
    // If compression is active, queue this operation
    if (this.isCompressing) {
      this.logger.debug('Queueing add operation during compression', {
        speaker: content.speaker,
        blockTypes: content.blocks?.map((b) => b.type),
      });

      this.pendingOperations.push(() => {
        this.addInternal(content, modelName);
      });
      return;
    }

    // Otherwise, add immediately
    this.addInternal(content, modelName);
  }

  private addInternal(content: IContent, modelName?: string): void {
    // Log content being added with any tool call/response IDs
    this.logger.debug('Adding content to history:', {
      speaker: content.speaker,
      blockTypes: content.blocks?.map((b) => b.type),
      toolCallIds: content.blocks
        ?.filter((b) => b.type === 'tool_call')
        .map((b) => (b as ToolCallBlock).id),
      toolResponseIds: content.blocks
        ?.filter((b) => b.type === 'tool_response')
        .map((b) => ({
          callId: (b as ToolResponseBlock).callId,
          toolName: (b as ToolResponseBlock).toolName,
        })),
      contentId: content.metadata?.id,
      modelName,
    });

    // Only do basic validation - must have valid speaker
    if (content.speaker && ['human', 'ai', 'tool'].includes(content.speaker)) {
      this.history.push(content);

      this.logger.debug(
        'Content added successfully, history length:',
        this.history.length,
      );

      // Update token count asynchronously but atomically
      this.updateTokenCount(content, modelName);
    } else {
      this.logger.debug('Content rejected - invalid speaker:', content.speaker);
    }
  }

  /**
   * Atomically update token count for new content
   */
  private async updateTokenCount(
    content: IContent,
    modelName?: string,
  ): Promise<void> {
    // Use a lock to prevent race conditions
    this.tokenizerLock = this.tokenizerLock.then(async () => {
      // Always derive token counts from the stored content to avoid double counting
      // when providers attach aggregate usage metadata (which already includes prompt tokens).
      const defaultModel = modelName || 'gpt-4.1';
      const contentTokens = await this.estimateContentTokens(
        content,
        defaultModel,
      );

      // Atomically update the total
      this.totalTokens += contentTokens;

      // Emit event with updated count
      const eventData = {
        totalTokens: this.getTotalTokens(),
        addedTokens: contentTokens,
        contentId: content.metadata?.id,
      };

      this.logger.debug('Emitting tokensUpdated:', eventData);

      this.emit('tokensUpdated', eventData);
    });

    return this.tokenizerLock;
  }

  /**
   * Estimate token count for content using tokenizer
   */
  private async estimateContentTokens(
    content: IContent,
    modelName: string,
  ): Promise<number> {
    const tokenizer = this.getTokenizerForModel(modelName);
    let totalTokens = 0;

    for (const block of content.blocks) {
      let blockText = '';

      switch (block.type) {
        case 'text':
          blockText = block.text;
          break;
        case 'tool_call':
          try {
            blockText = JSON.stringify({
              name: block.name,
              parameters: block.parameters,
            });
          } catch (error) {
            // Handle circular references or other JSON.stringify errors
            this.logger.debug(
              'Error stringifying tool_call parameters, using fallback:',
              error,
            );
            // Fallback to just the tool name for token estimation
            blockText = `tool_call: ${block.name}`;
          }
          break;
        case 'tool_response':
          // Check if result is already a string (common for tool responses)
          if (typeof block.result === 'string') {
            blockText = block.result;
          } else if (block.error) {
            blockText =
              typeof block.error === 'string'
                ? block.error
                : JSON.stringify(block.error);
          } else {
            // Try to stringify the result
            try {
              blockText = JSON.stringify(block.result || '');
            } catch (error) {
              // Handle circular references or other JSON.stringify errors
              this.logger.debug(
                'Error stringifying tool_response result, using string conversion:',
                error,
              );
              // Try to convert to string as fallback
              try {
                blockText = String(block.result);
              } catch {
                // Ultimate fallback
                blockText = `[tool_response: ${block.toolName || 'unknown'} - content too large or complex to stringify]`;
              }
            }
          }
          break;
        case 'thinking':
          blockText = block.thought;
          break;
        case 'code':
          blockText = block.code;
          break;
        case 'media':
          // For media, just count the caption if any
          blockText = block.caption || '';
          break;
        default:
          // Unknown block type, skip
          break;
      }

      if (blockText) {
        try {
          const blockTokens = await tokenizer.countTokens(blockText, modelName);
          totalTokens += blockTokens;
        } catch (error) {
          this.logger.debug(
            'Error counting tokens for block, using fallback:',
            error,
          );
          totalTokens += this.simpleTokenEstimateForText(blockText);
        }
      }
    }

    return totalTokens;
  }

  /**
   * Simple token estimation for text
   */
  private simpleTokenEstimateForText(text: string): number {
    if (!text) return 0;
    const wordCount = text.split(/\s+/).length;
    const characterCount = text.length;
    return Math.round(Math.max(wordCount * 1.3, characterCount / 4));
  }

  /**
   * Add multiple contents to the history
   */
  addAll(contents: IContent[], modelName?: string): void {
    for (const content of contents) {
      this.add(content, modelName);
    }
  }

  /**
   * Estimate total tokens for hypothetical contents without mutating history.
   */
  async estimateTokensForContents(
    contents: IContent[],
    modelName?: string,
  ): Promise<number> {
    if (contents.length === 0) {
      return 0;
    }

    let total = 0;
    for (const content of contents) {
      const effectiveModel = content.metadata?.model || modelName || 'gpt-4.1';
      try {
        total += await this.estimateContentTokens(content, effectiveModel);
      } catch (error) {
        this.logger.debug(
          'Error estimating tokens for content, using fallback:',
          error,
        );
        let serialized = '';
        try {
          serialized = JSON.stringify(content);
        } catch (stringifyError) {
          this.logger.debug(
            'Failed to stringify content for fallback token estimate:',
            stringifyError,
          );
        }

        if (serialized) {
          total += estimateTextTokens(serialized);
        } else {
          const blockStrings = content.blocks
            ?.map((block) => {
              switch (block.type) {
                case 'text':
                  return block.text;
                case 'tool_call':
                  return JSON.stringify({
                    name: block.name,
                    parameters: block.parameters,
                  });
                case 'tool_response':
                  return JSON.stringify({
                    callId: block.callId,
                    toolName: block.toolName,
                    result: block.result,
                    error: block.error,
                  });
                case 'thinking':
                  return block.thought;
                case 'code':
                  return block.code;
                case 'media':
                  return block.caption ?? '';
                default:
                  return '';
              }
            })
            .join('\n');
          if (blockStrings) {
            total += estimateTextTokens(blockStrings);
          }
        }
      }
    }

    return total;
  }

  /**
   * Wait for any in-flight token updates to complete.
   */
  async waitForTokenUpdates(): Promise<void> {
    await this.tokenizerLock;
  }

  /**
   * Apply a density optimization result to the raw history.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-001.6, REQ-HD-001.7
   * @pseudocode history-service.md lines 20-82
   */
  async applyDensityResult(result: DensityResult): Promise<void> {
    // === VALIDATION PHASE ===

    // V1: Check for duplicates in removals
    const removalSet = new Set(result.removals);
    if (removalSet.size !== result.removals.length) {
      throw new CompressionStrategyError(
        'DensityResult contains duplicate removal indices',
        'DENSITY_INVALID_RESULT',
      );
    }

    // V2: Check no index appears in both removals and replacements
    for (const index of result.replacements.keys()) {
      if (removalSet.has(index)) {
        throw new CompressionStrategyError(
          `DensityResult conflict: index ${index} in both removals and replacements`,
          'DENSITY_CONFLICT',
        );
      }
    }

    // V3: Validate removal indices are within bounds
    for (const index of result.removals) {
      if (index < 0 || index >= this.history.length) {
        throw new CompressionStrategyError(
          `DensityResult removal index ${index} out of bounds [0, ${this.history.length})`,
          'DENSITY_INDEX_OUT_OF_BOUNDS',
        );
      }
    }

    // V4: Validate replacement indices are within bounds
    for (const index of result.replacements.keys()) {
      if (index < 0 || index >= this.history.length) {
        throw new CompressionStrategyError(
          `DensityResult replacement index ${index} out of bounds [0, ${this.history.length})`,
          'DENSITY_INDEX_OUT_OF_BOUNDS',
        );
      }
    }

    // === MUTATION PHASE ===

    // M1: Apply replacements first — indices are stable (no length changes)
    for (const [index, replacement] of result.replacements) {
      this.history[index] = replacement;
      this.logger.debug('Density: replaced history entry', { index });
    }

    // M2: Sort removals in descending order to preserve earlier indices during splice
    const sortedRemovals = [...result.removals].sort((a, b) => b - a);

    // M3: Apply removals in reverse order
    for (const index of sortedRemovals) {
      this.history.splice(index, 1);
      this.logger.debug('Density: removed history entry', { index });
    }

    this.logger.debug('Density: applied result', {
      replacements: result.replacements.size,
      removals: result.removals.length,
      newHistoryLength: this.history.length,
      metadata: result.metadata,
    });

    // === TOKEN RECALCULATION PHASE ===

    // T1: Full recalculation through tokenizerLock
    await this.recalculateTotalTokens();
  }

  /**
   * Return a read-only typed view of the backing history array.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.5
   * @pseudocode history-service.md lines 10-15
   */
  getRawHistory(): readonly IContent[] {
    return this.history;
  }

  /**
   * Force a full token recalculation after density operations.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.6
   * @pseudocode history-service.md lines 90-120
   */
  async recalculateTotalTokens(): Promise<void> {
    this.tokenizerLock = this.tokenizerLock.then(async () => {
      let newTotal = 0;
      const defaultModel = 'gpt-4.1';

      for (const entry of this.history) {
        const entryTokens = await this.estimateContentTokens(
          entry,
          defaultModel,
        );
        newTotal += entryTokens;
      }

      const previousTotal = this.totalTokens;
      this.totalTokens = newTotal;

      this.logger.debug('Density: recalculated total tokens', {
        previousTotal,
        newTotal,
        entryCount: this.history.length,
      });

      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: newTotal - previousTotal,
        contentId: null,
      });
    });

    return this.tokenizerLock;
  }

  /**
   * Get all history
   */
  getAll(): IContent[] {
    return [...this.history];
  }

  /**
   * Release all listeners and internal buffers to allow GC
   */
  dispose(): void {
    try {
      this.removeAllListeners();
    } catch {
      // Best-effort; listener removal is not critical
    }

    this.history = [];
    this.totalTokens = 0;
    this.baseTokenOffset = 0;
    this.isCompressing = false;
    this.pendingOperations = [];
    this.tokenizerCache.clear();
    this.tokenizerLock = Promise.resolve();
  }

  /**
   * Clear all history
   */
  clear(): void {
    // If compression is active, queue this operation
    if (this.isCompressing) {
      this.logger.debug('Queueing clear operation during compression');
      this.pendingOperations.push(() => {
        this.clearInternal();
      });
      return;
    }

    // Otherwise, clear immediately
    this.clearInternal();
  }

  private clearInternal(): void {
    this.logger.debug('Clearing history', {
      previousLength: this.history.length,
    });

    const previousTokens = this.totalTokens;
    this.history = [];
    this.totalTokens = 0;

    // Emit event with reset count
    this.emit('tokensUpdated', {
      totalTokens: this.getTotalTokens(),
      addedTokens: -previousTokens, // Negative to indicate removal
      contentId: null,
    });
  }

  /**
   * Get the last N messages from history
   */
  getRecent(count: number): IContent[] {
    return this.history.slice(-count);
  }

  /**
   * Get curated history (only valid, meaningful content)
   * Matches the behavior of extractCuratedHistory in geminiChat.ts:
   * - Always includes user/human messages
   * - Always includes tool messages
   * - Only includes AI messages if they are valid (have content)
   */
  getCurated(): IContent[] {
    // Wait if compression is in progress
    if (this.isCompressing) {
      this.logger.debug(
        'getCurated called during compression - returning snapshot',
      );
    }

    // Build the curated list without modifying history
    const curated: IContent[] = [];
    let excludedCount = 0;
    let aiMessagesAnalyzed = 0;
    let aiMessagesIncluded = 0;

    for (const content of this.history) {
      if (content.speaker === 'human' || content.speaker === 'tool') {
        // Always include user and tool messages
        curated.push(content);
      } else if (content.speaker === 'ai') {
        aiMessagesAnalyzed++;
        // Only include AI messages if they have valid content
        const hasValidContent = ContentValidation.hasContent(content);

        // Only do expensive debug logging if debug is enabled
        if (this.logger.enabled) {
          this.logger.debug('Analyzing AI message:', {
            messageIndex: aiMessagesAnalyzed,
            hasValidContent,
            blockCount: content.blocks?.length || 0,
            blocks: content.blocks?.map((b) => ({
              type: b.type,
              textLength:
                b.type === 'text' ? (b as TextBlock).text?.length : null,
              textPreview:
                b.type === 'text'
                  ? (b as TextBlock).text?.substring(0, 50)
                  : null,
              isEmpty:
                b.type === 'text' ? !(b as TextBlock).text?.trim() : false,
            })),
            metadata: {
              hasUsage: !!content.metadata?.usage,
              tokens: content.metadata?.usage?.totalTokens,
            },
          });
        }

        if (hasValidContent) {
          curated.push(content);
          aiMessagesIncluded++;
        } else {
          excludedCount++;
          if (this.logger.enabled) {
            this.logger.debug('EXCLUDED AI message - no valid content');
          }
        }
      }
    }

    // Only log summary if debug is enabled
    if (this.logger.enabled) {
      this.logger.debug('=== CURATED HISTORY SUMMARY ===', {
        totalHistory: this.history.length,
        curatedCount: curated.length,
        breakdown: {
          aiMessages: {
            total: aiMessagesAnalyzed,
            included: aiMessagesIncluded,
            excluded: excludedCount,
            exclusionRate:
              aiMessagesAnalyzed > 0
                ? `${((excludedCount / aiMessagesAnalyzed) * 100).toFixed(1)}%`
                : '0%',
          },
          humanMessages: curated.filter((c) => c.speaker === 'human').length,
          toolMessages: curated.filter((c) => c.speaker === 'tool').length,
        },
        toolActivity: {
          toolCallsInCurated: curated.reduce(
            (acc, c) =>
              acc + c.blocks.filter((b) => b.type === 'tool_call').length,
            0,
          ),
          toolResponsesInCurated: curated.reduce(
            (acc, c) =>
              acc + c.blocks.filter((b) => b.type === 'tool_response').length,
            0,
          ),
        },
        isCompressing: this.isCompressing,
      });
    }

    return curated;
  }

  /**
   * Get comprehensive history (all content including invalid/empty)
   */
  getComprehensive(): IContent[] {
    return [...this.history];
  }

  /**
   * Remove the last content if it matches the provided content
   */
  removeLastIfMatches(content: IContent): boolean {
    const last = this.history[this.history.length - 1];
    if (last === content) {
      this.history.pop();
      return true;
    }
    return false;
  }

  /**
   * Pop the last content from history
   */
  pop(): IContent | undefined {
    const removed = this.history.pop();
    if (removed) {
      // Recalculate tokens since we removed content
      // This is less efficient but ensures accuracy
      this.recalculateTokens();
    }
    return removed;
  }

  /**
   * Recalculate total tokens from scratch
   * Use this when removing content or when token counts might be stale
   */
  async recalculateTokens(defaultModel: string = 'gpt-4.1'): Promise<void> {
    this.tokenizerLock = this.tokenizerLock.then(async () => {
      let newTotal = 0;

      for (const content of this.history) {
        // Use the model from content metadata, or fall back to provided default
        const modelToUse = content.metadata?.model || defaultModel;
        newTotal += await this.estimateContentTokens(content, modelToUse);
      }

      const oldTotal = this.totalTokens;
      this.totalTokens = newTotal;

      // Emit event with updated count
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: this.totalTokens - oldTotal,
        contentId: null,
      });
    });

    return this.tokenizerLock;
  }

  /**
   * Get the last user (human) content
   */
  getLastUserContent(): IContent | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].speaker === 'human') {
        return this.history[i];
      }
    }
    return undefined;
  }

  /**
   * Get the last AI content
   */
  getLastAIContent(): IContent | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].speaker === 'ai') {
        return this.history[i];
      }
    }
    return undefined;
  }

  /**
   * Record a complete turn (user input + AI response + optional tool interactions)
   */
  recordTurn(
    userInput: IContent,
    aiResponse: IContent,
    toolInteractions?: IContent[],
  ): void {
    this.add(userInput);
    this.add(aiResponse);
    if (toolInteractions) {
      this.addAll(toolInteractions);
    }
  }

  /**
   * Get the number of messages in history
   */
  length(): number {
    return this.history.length;
  }

  /**
   * Check if history is empty
   */
  isEmpty(): boolean {
    return this.history.length === 0;
  }

  /**
   * Clone the history (deep copy)
   */
  clone(): IContent[] {
    return JSON.parse(JSON.stringify(this.history));
  }

  /**
   * Find unmatched tool calls (tool calls without responses)
   */
  findUnmatchedToolCalls(): ToolCallBlock[] {
    const respondedCallIds = new Set<string>();

    for (const content of this.history) {
      if (!content.blocks) continue;
      for (const block of content.blocks) {
        if (block.type === 'tool_response') {
          const response = block as ToolResponseBlock;
          if (response.callId) {
            respondedCallIds.add(response.callId);
          }
        }
      }
    }

    const unmatched: ToolCallBlock[] = [];
    const seenToolCallIds = new Set<string>();

    for (const content of this.history) {
      if (!content.blocks) continue;
      for (const block of content.blocks) {
        if (block.type !== 'tool_call') continue;

        const toolCall = block as ToolCallBlock;
        if (!toolCall.id) continue;
        if (seenToolCallIds.has(toolCall.id)) continue;
        seenToolCallIds.add(toolCall.id);

        if (!respondedCallIds.has(toolCall.id)) {
          unmatched.push(toolCall);
        }
      }
    }

    this.logger.debug('Unmatched tool calls detected:', {
      unmatchedCount: unmatched.length,
      unmatchedIds: unmatched.map((c) => c.id),
    });

    return unmatched;
  }

  /**
   * Validate and fix the history to ensure proper tool call/response pairing
   */
  validateAndFix(): void {
    const respondedCallIds = new Set<string>();
    for (const content of this.history) {
      if (!content.blocks) continue;
      for (const block of content.blocks) {
        if (block.type === 'tool_response') {
          const response = block as ToolResponseBlock;
          if (response.callId) {
            respondedCallIds.add(response.callId);
          }
        }
      }
    }

    let insertedCount = 0;

    for (let i = 0; i < this.history.length; i++) {
      const content = this.history[i];
      if (content.speaker !== 'ai' || !content.blocks) continue;

      const toolCalls = content.blocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool_call',
      );

      if (toolCalls.length === 0) continue;

      const missing = toolCalls.filter(
        (tc) => tc.id && !respondedCallIds.has(tc.id),
      );

      if (missing.length === 0) continue;

      const syntheticToolMessage: IContent = {
        speaker: 'tool',
        blocks: missing.map(
          (tc): ToolResponseBlock => ({
            type: 'tool_response',
            callId: tc.id,
            toolName: tc.name || 'unknown_tool',
            result: null,
            error: 'Tool call interrupted or cancelled',
            isComplete: true,
          }),
        ),
        metadata: {
          synthetic: true,
          reason: 'orphaned_tool_call',
        },
      };

      // Insert immediately after the assistant message so providers that
      // require strict tool-response adjacency remain valid.
      this.history.splice(i + 1, 0, syntheticToolMessage);
      insertedCount += 1;

      for (const tc of missing) {
        respondedCallIds.add(tc.id);
      }

      // Keep token counts consistent with the stored history.
      void this.updateTokenCount(syntheticToolMessage);

      // Skip over the inserted message.
      i += 1;
    }

    this.logger.debug('History validation complete:', {
      insertedSyntheticToolMessages: insertedCount,
      historyLength: this.history.length,
    });
  }

  /**
   * Get curated history with circular references removed for providers.
   * This ensures the history can be safely serialized and sent to providers.
   */
  getCuratedForProvider(
    tailContents: IContent[] = [],
    options?: { strictToolAdjacency?: boolean },
  ): IContent[] {
    const strictToolAdjacency = options?.strictToolAdjacency ?? false;

    // Get the curated history
    const curated = this.getCurated();
    const combined =
      tailContents.length > 0 ? [...curated, ...tailContents] : curated;

    // Defensive: if a tool-speaker message accidentally contains tool_call
    // blocks (e.g., cancellation history recorded as a single "user" Content
    // containing both functionCall + functionResponse parts), split them into
    // provider-compliant turns.
    const split = this.splitToolCallsOutOfToolMessages(combined);

    // Ensure every tool response has a corresponding tool call for provider payloads
    const normalized = this.ensureToolCallContinuity(split);

    // Ensure every tool call has some corresponding tool response in provider
    // payloads, even if the tool execution was interrupted or cancelled.
    const completed = this.ensureToolResponseCompleteness(
      normalized,
      strictToolAdjacency,
    );

    // Providers like OpenAI Chat and Anthropic require strict tool adjacency:
    // tool results must appear directly after the assistant tool call message.
    // Corrupted histories can contain duplicate or out-of-order tool results,
    // which will 400 on provider switching. Normalize ordering and drop dupes.
    const ordered = this.ensureToolResponseAdjacency(completed);

    // Deep clone to avoid circular references in tool call parameters
    // We need a clean copy that can be serialized
    return this.deepCloneWithoutCircularRefs(ordered);
  }

  /**
   * Providers expect tool calls to come from the assistant and tool results to
   * come from the tool role. If history corruption produces a single "tool"
   * message that contains both tool_call and tool_response blocks, split the
   * tool_call blocks into a separate assistant message directly before the tool
   * message.
   */
  private splitToolCallsOutOfToolMessages(contents: IContent[]): IContent[] {
    const result: IContent[] = [];

    for (const content of contents) {
      if (content.speaker !== 'tool' || !content.blocks?.length) {
        result.push(content);
        continue;
      }

      const toolCalls = content.blocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool_call',
      );

      if (toolCalls.length === 0) {
        result.push(content);
        continue;
      }

      const remainingBlocks = content.blocks.filter(
        (b) => b.type !== 'tool_call',
      );

      result.push({
        speaker: 'ai',
        blocks: toolCalls,
        metadata: {
          synthetic: true,
          reason: 'extracted_tool_call_from_tool_message',
        },
      });

      if (remainingBlocks.length > 0) {
        result.push({
          ...content,
          blocks: remainingBlocks,
        });
      }
    }

    return result;
  }

  /**
   * Ensure every tool_response has a matching tool_call.
   * If compression removed the original tool_call, synthesize a minimal placeholder
   * so providers receive a structurally valid transcript without losing context.
   */
  private ensureToolCallContinuity(contents: IContent[]): IContent[] {
    const seenToolCallIds = new Set<string>();
    const normalized: IContent[] = [];

    for (const content of contents) {
      if (content.blocks && content.blocks.length > 0) {
        for (const block of content.blocks) {
          if (block.type === 'tool_call') {
            seenToolCallIds.add((block as ToolCallBlock).id);
          }
        }
      }

      if (content.speaker === 'tool' && content.blocks?.length) {
        const missingResponses = content.blocks.filter(
          (block) =>
            block.type === 'tool_response' &&
            !seenToolCallIds.has((block as ToolResponseBlock).callId),
        ) as ToolResponseBlock[];

        if (missingResponses.length > 0) {
          const reconstructedBlocks = missingResponses.map((response) => {
            const reconstructed: ToolCallBlock = {
              type: 'tool_call',
              id: response.callId,
              name: response.toolName || 'unknown_tool',
              parameters: { reconstructed: true },
              description: 'Reconstructed tool call after compression',
            };
            return reconstructed;
          });

          this.logger.warn('Synthesizing missing tool_call for responses', {
            callIds: reconstructedBlocks.map((block) => block.id),
            toolNames: reconstructedBlocks.map((block) => block.name),
          });

          normalized.push({
            speaker: 'ai',
            blocks: reconstructedBlocks,
            metadata: {
              synthetic: true,
              reason: 'reconstructed_tool_call',
            },
          });

          for (const block of reconstructedBlocks) {
            seenToolCallIds.add(block.id);
          }
        }
      }

      normalized.push(content);
    }

    return normalized;
  }

  /**
   * Ensure every tool_call has a corresponding tool_response.
   *
   * Provider transcripts with orphaned tool calls can hard-fail strict APIs
   * (e.g., Anthropic requires tool_result blocks immediately after tool_use).
   * For provider-visible payloads, synthesize a minimal "cancelled" tool result
   * so the transcript remains structurally valid.
   *
   * When strictToolAdjacency is true, synthesize tool responses for all orphaned
   * tool calls regardless of whether a later non-tool message exists. This is
   * required for providers like Anthropic that enforce strict tool-use/tool-result pairing.
   *
   * This is intentionally non-mutating: it does not modify the stored history,
   * only the provider-facing view.
   */
  private ensureToolResponseCompleteness(
    contents: IContent[],
    strictToolAdjacency: boolean = false,
  ): IContent[] {
    const respondedCallIds = new Set<string>();

    for (const content of contents) {
      if (!content.blocks?.length) continue;
      for (const block of content.blocks) {
        if (block.type !== 'tool_response') continue;
        const callId = (block as ToolResponseBlock).callId;
        if (callId) {
          respondedCallIds.add(callId);
        }
      }
    }

    const hasLaterNonToolMessageByIndex = strictToolAdjacency
      ? []
      : new Array<boolean>(contents.length).fill(false);

    if (!strictToolAdjacency) {
      let seenNonToolAfter = false;
      for (let i = contents.length - 1; i >= 0; i--) {
        hasLaterNonToolMessageByIndex[i] = seenNonToolAfter;
        if (contents[i]?.speaker !== 'tool') {
          seenNonToolAfter = true;
        }
      }
    }

    const result: IContent[] = [];

    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      result.push(content);

      if (content.speaker !== 'ai' || !content.blocks?.length) continue;

      const toolCalls = content.blocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool_call',
      );
      if (toolCalls.length === 0) continue;

      const missing = toolCalls.filter(
        (tc) => tc.id && !respondedCallIds.has(tc.id),
      );
      if (missing.length === 0) continue;

      // In strict mode or when the conversation has advanced past this tool call,
      // synthesize tool responses for orphaned tool calls.
      // Strict mode (e.g., for Anthropic): always synthesize tool responses.
      // Non-strict mode: only synthesize if there's a later non-tool message.
      // This preserves "pending tool call" state for UI while fixing orphaned calls.
      if (!strictToolAdjacency && !hasLaterNonToolMessageByIndex[i]) {
        continue;
      }

      result.push({
        speaker: 'tool',
        blocks: missing.map(
          (tc): ToolResponseBlock => ({
            type: 'tool_response',
            callId: tc.id,
            toolName: tc.name || 'unknown_tool',
            result: null,
            error: 'Tool call interrupted or cancelled',
            isComplete: true,
          }),
        ),
        metadata: {
          synthetic: true,
          reason: 'orphaned_tool_call',
        },
      });

      for (const tc of missing) {
        respondedCallIds.add(tc.id);
      }
    }

    return result;
  }

  /**
   * Ensure tool responses appear immediately after the assistant message that
   * introduced their tool calls, and drop duplicate/out-of-order tool responses.
   *
   * Some providers strictly validate tool adjacency (e.g., OpenAI Chat tool
   * messages must follow an assistant tool_calls message; Anthropic tool_results
   * must correspond to tool_use blocks in the previous assistant message).
   */
  private ensureToolResponseAdjacency(contents: IContent[]): IContent[] {
    const toolCallIndexById = new Map<string, number>();

    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      if (!content.blocks?.length) continue;
      for (const block of content.blocks) {
        if (block.type !== 'tool_call') continue;
        const id = (block as ToolCallBlock).id;
        if (id && !toolCallIndexById.has(id)) {
          toolCallIndexById.set(id, i);
        }
      }
    }

    const responsesByToolCallIndex = new Map<number, ToolResponseBlock[]>();
    const keptResponseByCallId = new Map<
      string,
      {
        toolCallIndex: number;
        responseIndex: number;
        response: ToolResponseBlock;
      }
    >();

    const scoreResponse = (response: ToolResponseBlock): number => {
      let score = 0;
      if (response.isComplete) score += 2;
      if (response.error) score -= 1;
      if (response.result !== undefined && response.result !== null) score += 1;
      return score;
    };

    const strippedContents: Array<IContent | null> = contents.map((content) => {
      if (!content.blocks?.length) return content;

      const toolResponseBlocks = content.blocks.filter(
        (b): b is ToolResponseBlock => b.type === 'tool_response',
      );

      if (toolResponseBlocks.length === 0) {
        return content;
      }

      for (const toolResponse of toolResponseBlocks) {
        const callId = toolResponse.callId;
        if (!callId) continue;

        const toolCallIndex = toolCallIndexById.get(callId);
        if (toolCallIndex === undefined) {
          // Should be rare after ensureToolCallContinuity. Keep the response in
          // place (do not strip) to avoid silently losing tool output.
          this.logger.warn('Tool response missing matching tool call', {
            callId,
            toolName: toolResponse.toolName,
          });
          continue;
        }

        const existing = keptResponseByCallId.get(callId);
        if (existing) {
          const existingScore = scoreResponse(existing.response);
          const newScore = scoreResponse(toolResponse);
          if (newScore > existingScore) {
            const list = responsesByToolCallIndex.get(existing.toolCallIndex);
            if (list) {
              list[existing.responseIndex] = toolResponse;
              keptResponseByCallId.set(callId, {
                toolCallIndex: existing.toolCallIndex,
                responseIndex: existing.responseIndex,
                response: toolResponse,
              });
            }
          }
          continue;
        }

        const list = responsesByToolCallIndex.get(toolCallIndex) ?? [];
        list.push(toolResponse);
        responsesByToolCallIndex.set(toolCallIndex, list);
        keptResponseByCallId.set(callId, {
          toolCallIndex,
          responseIndex: list.length - 1,
          response: toolResponse,
        });
      }

      const remainingBlocks = content.blocks.filter(
        (b) => b.type !== 'tool_response',
      );

      // After stripping, drop tool-speaker messages entirely; providers will
      // receive the consolidated tool results inserted after tool_call messages.
      if (content.speaker === 'tool') {
        return null;
      }

      if (remainingBlocks.length === 0) {
        return null;
      }

      return {
        ...content,
        blocks: remainingBlocks,
      };
    });

    const result: IContent[] = [];

    for (let i = 0; i < strippedContents.length; i++) {
      const content = strippedContents[i];
      if (content) {
        result.push(content);
      }

      const responses = responsesByToolCallIndex.get(i);
      if (responses && responses.length > 0) {
        result.push({
          speaker: 'tool',
          blocks: responses,
          metadata: {
            synthetic: true,
            reason: 'reordered_tool_responses',
          },
        });
      }
    }

    return result;
  }

  /**
   * Deep clone content array, removing circular references
   */
  private deepCloneWithoutCircularRefs(contents: IContent[]): IContent[] {
    return contents.map((content) => {
      // Create a clean copy of the content
      const cloned: IContent = {
        speaker: content.speaker,
        blocks: content.blocks.map((block) => {
          if (block.type === 'tool_call') {
            const toolCall = block as ToolCallBlock;
            // For tool calls, sanitize the parameters to remove circular refs
            return {
              type: 'tool_call',
              id: toolCall.id,
              name: toolCall.name,
              parameters: this.sanitizeParams(toolCall.parameters),
            } as ToolCallBlock;
          } else if (block.type === 'tool_response') {
            const toolResponse = block as ToolResponseBlock;
            // For tool responses, sanitize the result to remove circular refs
            return {
              type: 'tool_response',
              callId: toolResponse.callId,
              toolName: toolResponse.toolName,
              result: this.sanitizeParams(toolResponse.result),
              error: toolResponse.error,
              isComplete: toolResponse.isComplete,
            } as ToolResponseBlock;
          } else {
            // Other blocks should be safe to clone
            try {
              return JSON.parse(JSON.stringify(block));
            } catch {
              // If any block fails, return minimal version
              return { ...block };
            }
          }
        }),
        metadata: content.metadata ? { ...content.metadata } : {},
      };
      return cloned;
    });
  }

  /**
   * Sanitize parameters to remove circular references
   */
  private sanitizeParams(params: unknown): unknown {
    const seen = new WeakSet();

    const sanitize = (obj: unknown): unknown => {
      // Handle primitives
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      // Check for circular reference
      if (seen.has(obj)) {
        return { _circular: true };
      }

      seen.add(obj);

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map((item) => sanitize(item));
      }

      // Handle objects
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = sanitize(value);
      }

      return result;
    };

    try {
      return sanitize(params);
    } catch (error) {
      this.logger.debug('Error sanitizing params:', error);
      return {
        _note: 'Parameters contained circular references and were sanitized',
      };
    }
  }

  /**
   * Merge two histories, handling duplicates and conflicts
   */
  merge(other: HistoryService): void {
    // Simple append for now - could be made smarter to detect duplicates
    this.addAll(other.getAll());
  }

  /**
   * Get history within a token limit (for context window management)
   */
  getWithinTokenLimit(
    maxTokens: number,
    countTokensFn: (content: IContent) => number,
  ): IContent[] {
    const result: IContent[] = [];
    let totalTokens = 0;

    // Work backwards to keep most recent messages
    for (let i = this.history.length - 1; i >= 0; i--) {
      const content = this.history[i];
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
   * Summarize older history to fit within token limits
   */
  async summarizeOldHistory(
    keepRecentCount: number,
    summarizeFn: (contents: IContent[]) => Promise<IContent>,
  ): Promise<void> {
    if (this.history.length <= keepRecentCount) {
      return;
    }

    const toSummarize = this.history.slice(0, -keepRecentCount);
    const toKeep = this.history.slice(-keepRecentCount);

    const summary = await summarizeFn(toSummarize);
    this.history = [summary, ...toKeep];
  }

  /**
   * Export history to JSON
   */
  toJSON(): string {
    return JSON.stringify(this.history, null, 2);
  }

  /**
   * Import history from JSON
   */
  static fromJSON(json: string): HistoryService {
    const service = new HistoryService();
    const history = JSON.parse(json);
    service.addAll(history);
    return service;
  }

  /**
   * Mark compression as starting
   * This will cause add() operations to queue until compression completes
   */
  startCompression(): void {
    this.logger.debug('Starting compression - locking history');
    this.isCompressing = true;
  }

  /**
   * Mark compression as complete
   * This will flush all queued operations
   */
  endCompression(): void {
    this.logger.debug('Compression complete - unlocking history', {
      pendingCount: this.pendingOperations.length,
    });

    this.isCompressing = false;

    // Flush all pending operations
    const operations = this.pendingOperations;
    this.pendingOperations = [];

    for (const operation of operations) {
      operation();
    }

    this.logger.debug('Flushed pending operations', {
      count: operations.length,
    });
  }

  /**
   * Wait for all pending operations to complete
   * For synchronous operations, this is now a no-op but kept for API compatibility
   */
  async waitForPendingOperations(): Promise<void> {
    // Since operations are now synchronous, nothing to wait for
    return Promise.resolve();
  }

  /**
   * Get conversation statistics
   */
  getStatistics(): {
    totalMessages: number;
    userMessages: number;
    aiMessages: number;
    toolCalls: number;
    toolResponses: number;
    totalTokens?: number;
  } {
    let userMessages = 0;
    let aiMessages = 0;
    let toolCalls = 0;
    let toolResponses = 0;
    let totalTokens = 0;
    let hasTokens = false;

    for (const content of this.history) {
      if (content.speaker === 'human') {
        userMessages++;
      } else if (content.speaker === 'ai') {
        aiMessages++;
      }

      for (const block of content.blocks) {
        if (block.type === 'tool_call') {
          toolCalls++;
        } else if (block.type === 'tool_response') {
          toolResponses++;
        }
      }

      if (content.metadata?.usage) {
        totalTokens += content.metadata.usage.totalTokens;
        hasTokens = true;
      }
    }

    return {
      totalMessages: this.history.length,
      userMessages,
      aiMessages,
      toolCalls,
      toolResponses,
      totalTokens: hasTokens ? totalTokens : undefined,
    };
  }
}
