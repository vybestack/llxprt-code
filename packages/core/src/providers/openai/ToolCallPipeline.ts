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

/**
 * ToolCallPipeline - Simplified tool call processing pipeline
 *
 * Focused on collection and normalization phases only.
 * Tool execution is handled by the Core layer, not Provider layer.
 */

import { DebugLogger } from '../../debug/index.js';
import { ToolCallCollector } from './ToolCallCollector.js';
import {
  ToolCallNormalizer,
  type NormalizedToolCall,
} from './ToolCallNormalizer.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallPipeline');

export interface FailedToolCall {
  index: number;
  name?: string;
  args?: string;
  isValid: boolean;
  validationErrors: string[];
}

export interface PipelineResult {
  normalized: NormalizedToolCall[];
  failed: FailedToolCall[];
  stats: {
    collected: number;
    normalized: number;
    failed: number;
  };
}

/**
 * Simplified ToolCallPipeline - Collection and normalization only
 */
export class ToolCallPipeline {
  private collector: ToolCallCollector;
  private normalizer: ToolCallNormalizer;

  constructor() {
    this.collector = new ToolCallCollector();
    this.normalizer = new ToolCallNormalizer();
  }

  /**
   * Check for cancellation at the start
   */
  private createAbortError(): Error {
    // Use DOMException if available (modern environments)
    if (typeof DOMException !== 'undefined') {
      return new DOMException('Aborted', 'AbortError');
    }

    // Fallback for environments without DOMException support
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
  }

  /**
   * Add tool call fragment
   */
  addFragment(index: number, fragment: Partial<ToolCallFragment>): void {
    this.collector.addFragment(index, fragment);
  }

  /**
   * Process all collected tool calls (collection + normalization only)
   */
  async process(abortSignal?: AbortSignal): Promise<PipelineResult> {
    logger.debug('Starting simplified tool call pipeline processing');

    // Check for cancellation at the start
    if (abortSignal?.aborted) {
      throw this.createAbortError();
    }

    // Phase 1: Collect complete calls
    const candidates = this.collector.getCompleteCalls();
    logger.debug(`Collected ${candidates.length} complete tool calls`);

    // Phase 2: Normalize calls directly (no separate validation needed)
    const normalizedCalls: NormalizedToolCall[] = [];
    const failedCalls: FailedToolCall[] = [];

    try {
      for (const candidate of candidates) {
        // Check for cancellation in processing loop
        if (abortSignal?.aborted) {
          throw this.createAbortError();
        }
        try {
          // Create a mock validated call for normalization
          const mockValidatedCall = {
            index: candidate.index,
            id: candidate.id,
            name: candidate.name || '',
            args: candidate.args || '',
            isValid: true,
            validationErrors: [],
          };

          const normalized = this.normalizer.normalize(mockValidatedCall);
          if (normalized) {
            normalizedCalls.push(normalized);
          } else {
            failedCalls.push({
              index: candidate.index,
              name: candidate.name,
              args: candidate.args,
              isValid: false,
              validationErrors: ['Normalization failed'],
            });
          }
        } catch (error) {
          failedCalls.push({
            index: candidate.index,
            name: candidate.name,
            args: candidate.args,
            isValid: false,
            validationErrors: [
              error instanceof Error ? error.message : 'Unknown error',
            ],
          });
        }
      }

      logger.debug(
        `Normalized ${normalizedCalls.length} tool calls, ${failedCalls.length} failed`,
      );
    } finally {
      // Reset collector for next batch - always executed even on abort
      this.collector.reset();
    }

    const result: PipelineResult = {
      normalized: normalizedCalls,
      failed: failedCalls,
      stats: {
        collected: candidates.length,
        normalized: normalizedCalls.length,
        failed: failedCalls.length,
      },
    };

    logger.debug(
      `Pipeline processing completed: ${JSON.stringify(result.stats)}`,
    );
    return result;
  }

  /**
   * Normalize single tool name (for non-streaming path)
   */
  normalizeToolName(name: string, args?: string): string {
    const mockValidatedCall = {
      index: 0,
      name: name || '',
      args: args || '',
      isValid: true,
      validationErrors: [],
    };

    const normalized = this.normalizer.normalize(mockValidatedCall);
    return normalized?.name || name || '';
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    return {
      collector: this.collector.getStats(),
    };
  }

  /**
   * Reset pipeline state
   */
  reset(): void {
    this.collector.reset();
    logger.debug('ToolCallPipeline reset');
  }
}

// Import type from ToolCallCollector
import { type ToolCallFragment } from './ToolCallCollector.js';
