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

/**
 * Service for managing conversation history in a provider-agnostic way.
 * All history is stored as IContent. Providers are responsible for converting
 * to/from their own formats.
 */
export class HistoryService {
  private history: IContent[] = [];

  /**
   * Add content to the history
   */
  add(content: IContent): void {
    if (ContentValidation.isValid(content)) {
      this.history.push(content);
    }
  }

  /**
   * Add multiple contents to the history
   */
  addAll(contents: IContent[]): void {
    for (const content of contents) {
      this.add(content);
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
  }

  /**
   * Get the last N messages from history
   */
  getRecent(count: number): IContent[] {
    return this.history.slice(-count);
  }

  /**
   * Get curated history (only valid, meaningful content)
   */
  getCurated(): IContent[] {
    return this.history.filter((content) =>
      ContentValidation.hasContent(content),
    );
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
    return this.history.pop();
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
            matchedCallIds.add((block as ToolResponseBlock).callId);
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
            }
          }
        }
      }
    }

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
