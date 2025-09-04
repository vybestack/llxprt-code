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
  IContent,
  ContentValidation,
  ToolCallBlock,
  ToolResponseBlock,
} from './IContent.js';
import { EventEmitter } from 'events';
import { ITokenizer } from '../../providers/tokenizers/ITokenizer.js';
import { OpenAITokenizer } from '../../providers/tokenizers/OpenAITokenizer.js';
import { AnthropicTokenizer } from '../../providers/tokenizers/AnthropicTokenizer.js';
import { TokensUpdatedEvent } from './HistoryEvents.js';
import { DebugLogger } from '../../debug/index.js';
import { randomUUID } from 'crypto';

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
  private tokenizerCache = new Map<string, ITokenizer>();
  private tokenizerLock: Promise<void> = Promise.resolve();
  private logger = new DebugLogger('llxprt:history:service');

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
   * Generate a new normalized history tool ID.
   * Format: hist_tool_<uuid-v4>
   */
  generateHistoryId(): string {
    return `hist_tool_${randomUUID()}`;
  }

  /**
   * Get a callback suitable for passing into converters
   * which will generate normalized history IDs on demand.
   */
  getIdGeneratorCallback(): () => string {
    return () => this.generateHistoryId();
  }

  /**
   * Get the current total token count
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * Add content to the history
   * Note: We accept all content including empty responses for comprehensive history.
   * Filtering happens only when getting curated history.
   */
  add(content: IContent, modelName?: string): void {
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
      let contentTokens = 0;

      // First try to use usage data from the content metadata
      if (content.metadata?.usage) {
        contentTokens = content.metadata.usage.totalTokens;
      } else {
        // Fall back to tokenizer estimation
        // Default to gpt-4.1 tokenizer if no model name provided (most universal)
        const defaultModel = modelName || 'gpt-4.1';
        contentTokens = await this.estimateContentTokens(content, defaultModel);
      }

      // Atomically update the total
      this.totalTokens += contentTokens;

      // Emit event with updated count
      const eventData = {
        totalTokens: this.totalTokens,
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
          blockText = JSON.stringify({
            name: block.name,
            parameters: block.parameters,
          });
          break;
        case 'tool_response':
          blockText = JSON.stringify(block.result || block.error || '');
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
   * Get all history
   */
  getAll(): IContent[] {
    return [...this.history];
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history = [];
    this.totalTokens = 0;

    // Emit event with reset count
    this.emit('tokensUpdated', {
      totalTokens: 0,
      addedTokens: -this.totalTokens, // Negative to indicate removal
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
   * - Automatically adds synthetic responses for orphaned tool calls
   */
  getCurated(): IContent[] {
    // Auto-patch orphaned tool calls in the actual history first
    this.patchOrphanedToolCalls();

    // Now build the curated list from the patched history
    const curated: IContent[] = [];
    let excludedCount = 0;

    for (const content of this.history) {
      if (content.speaker === 'human' || content.speaker === 'tool') {
        // Always include user and tool messages
        curated.push(content);
      } else if (content.speaker === 'ai') {
        // Only include AI messages if they have valid content
        if (ContentValidation.hasContent(content)) {
          curated.push(content);
        } else {
          excludedCount++;
          this.logger.debug('Excluding AI content without valid content:', {
            blocks: content.blocks?.map((b) => ({
              type: b.type,
              hasContent:
                b.type === 'text' ? !!(b as { text?: string }).text : true,
            })),
          });
        }
      }
    }

    this.logger.debug('Curated history summary:', {
      totalHistory: this.history.length,
      curatedCount: curated.length,
      excludedAiCount: excludedCount,
      toolCallsInCurated: curated.reduce(
        (acc, c) => acc + c.blocks.filter((b) => b.type === 'tool_call').length,
        0,
      ),
      toolResponsesInCurated: curated.reduce(
        (acc, c) =>
          acc + c.blocks.filter((b) => b.type === 'tool_response').length,
        0,
      ),
    });

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
        if (content.metadata?.usage) {
          newTotal += content.metadata.usage.totalTokens;
        } else {
          // Use the model from content metadata, or fall back to provided default
          const modelToUse = content.metadata?.model || defaultModel;
          newTotal += await this.estimateContentTokens(content, modelToUse);
        }
      }

      const oldTotal = this.totalTokens;
      this.totalTokens = newTotal;

      // Emit event with updated count
      this.emit('tokensUpdated', {
        totalTokens: this.totalTokens,
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
    const unmatchedCalls: ToolCallBlock[] = [];
    const matchedCallIds = new Set<string>();

    // First, collect all tool response call IDs
    for (const content of this.history) {
      if (content.speaker === 'tool') {
        for (const block of content.blocks) {
          if (block.type === 'tool_response') {
            const callId = (block as ToolResponseBlock).callId;
            matchedCallIds.add(callId);
            this.logger.debug('Found tool response with callId:', callId);
          }
        }
      }
    }

    // Then find tool calls without responses
    for (const content of this.history) {
      if (content.speaker === 'ai') {
        for (const block of content.blocks) {
          if (block.type === 'tool_call') {
            const toolCall = block as ToolCallBlock;
            if (!matchedCallIds.has(toolCall.id)) {
              unmatchedCalls.push(toolCall);
              this.logger.debug('Found unmatched tool call:', {
                id: toolCall.id,
                name: toolCall.name,
              });
            } else {
              this.logger.debug('Found matched tool call:', {
                id: toolCall.id,
                name: toolCall.name,
              });
            }
          }
        }
      }
    }

    this.logger.debug('Unmatched tool calls summary:', {
      totalUnmatched: unmatchedCalls.length,
      unmatchedIds: unmatchedCalls.map((c) => c.id),
      totalMatched: matchedCallIds.size,
    });

    return unmatchedCalls;
  }

  /**
   * Validate and fix the history to ensure proper tool call/response pairing
   */
  validateAndFix(): void {
    const fixedHistory: IContent[] = [];
    const pendingToolCalls: Map<string, { callId: string; toolName: string }> =
      new Map();

    for (let i = 0; i < this.history.length; i++) {
      const content = this.history[i];
      fixedHistory.push(content);

      // Track tool calls from AI
      if (content.speaker === 'ai') {
        for (const block of content.blocks) {
          if (block.type === 'tool_call') {
            const toolCall = block as ToolCallBlock;
            pendingToolCalls.set(toolCall.id, {
              callId: toolCall.id,
              toolName: toolCall.name,
            });
          }
        }
      }

      // Remove matched tool calls when we see responses
      if (content.speaker === 'tool') {
        for (const block of content.blocks) {
          if (block.type === 'tool_response') {
            const response = block as ToolResponseBlock;
            pendingToolCalls.delete(response.callId);
          }
        }
      }

      // Check if next message is not a tool response but we have pending calls
      const nextContent = this.history[i + 1];
      if (
        nextContent &&
        nextContent.speaker !== 'tool' &&
        pendingToolCalls.size > 0
      ) {
        // Add synthetic error responses for unmatched calls
        for (const [, info] of pendingToolCalls) {
          fixedHistory.push({
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: info.callId,
                toolName: info.toolName,
                result: null,
                error: 'Error: Tool execution was interrupted. Please retry.',
              },
            ],
          });
        }
        pendingToolCalls.clear();
      }
    }

    // Handle any remaining pending calls at the end
    for (const [, info] of pendingToolCalls) {
      fixedHistory.push({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: info.callId,
            toolName: info.toolName,
            result: null,
            error: 'Error: Tool execution was interrupted. Please retry.',
          },
        ],
      });
    }

    this.history = fixedHistory;
  }

  /**
   * Patch orphaned tool calls by adding synthetic responses to the actual history.
   * This ensures that all tool calls have matching responses, which is required
   * by providers like OpenAI.
   */
  private patchOrphanedToolCalls(): void {
    // Find all unmatched tool calls
    const unmatchedCalls = this.findUnmatchedToolCalls();

    if (unmatchedCalls.length === 0) {
      return; // Nothing to patch
    }

    // Check if we've already patched these orphans (avoid duplicate patching)
    // Synthetic responses have metadata.synthetic = true
    const syntheticExists = this.history.some(
      (h) =>
        h.metadata?.synthetic === true &&
        h.metadata?.reason === 'orphaned_tool_call',
    );

    if (syntheticExists) {
      // Already patched, don't add duplicates
      return;
    }

    this.logger.debug('Patching orphaned tool calls:', {
      count: unmatchedCalls.length,
      ids: unmatchedCalls.map((c) => c.id),
    });

    // Group unmatched calls by their position in history
    // We need to insert synthetic responses after their corresponding AI messages
    const callPositions = new Map<number, ToolCallBlock[]>();

    for (let i = 0; i < this.history.length; i++) {
      const content = this.history[i];
      if (content.speaker === 'ai') {
        for (const block of content.blocks) {
          if (block.type === 'tool_call') {
            const toolCall = block as ToolCallBlock;
            // Check if this call is unmatched
            if (unmatchedCalls.some((u) => u.id === toolCall.id)) {
              if (!callPositions.has(i)) {
                callPositions.set(i, []);
              }
              callPositions.get(i)!.push(toolCall);
            }
          }
        }
      }
    }

    // Create synthetic responses and insert them after their AI messages
    // Process in reverse order to maintain correct indices
    const positions = Array.from(callPositions.keys()).sort((a, b) => b - a);

    for (const position of positions) {
      const orphanedCalls = callPositions.get(position)!;

      // Create a single tool response content with all synthetic responses
      const syntheticContent: IContent = {
        speaker: 'tool',
        blocks: orphanedCalls.map((call) => ({
          type: 'tool_response' as const,
          callId: call.id,
          toolName: call.name,
          result: null,
          error: 'Tool execution cancelled by user',
        })),
        metadata: {
          synthetic: true,
          reason: 'orphaned_tool_call',
        },
      };

      // Insert the synthetic response after the AI message that contains the tool calls
      this.history.splice(position + 1, 0, syntheticContent);

      this.logger.debug('Inserted synthetic tool response:', {
        afterPosition: position,
        forCallIds: orphanedCalls.map((c) => c.id),
      });
    }

    // Log if we added synthetic responses
    if (positions.length > 0) {
      this.logger.debug('Added synthetic responses for orphaned tool calls:', {
        syntheticResponsesAdded: positions.length,
        totalOrphanedCalls: unmatchedCalls.length,
      });
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
