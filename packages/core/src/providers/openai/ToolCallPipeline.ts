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
 * ToolCallPipeline - Tool call processing pipeline
 *
 * Integrated solution for collection, validation, normalization, and execution phases.
 * Replaces the original accumulation logic, providing reliable ToolCalls processing.
 */

import { DebugLogger } from '../../debug/index.js';
import { ToolCallCollector } from './ToolCallCollector.js';
import { ToolCallValidator, ValidatedToolCall } from './ToolCallValidator.js';
import {
  ToolCallNormalizer,
  NormalizedToolCall,
} from './ToolCallNormalizer.js';
import {
  ToolCallExecutor,
  ToolExecutionResult,
  ToolFunction,
} from './ToolCallExecutor.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallPipeline');

export interface PipelineResult {
  executed: ToolExecutionResult[];
  normalized: NormalizedToolCall[];
  failed: ValidatedToolCall[];
  stats: {
    collected: number;
    validated: number;
    normalized: number;
    executed: number;
    failed: number;
  };
}

/**
 * ToolCallPipeline - Complete tool call processing pipeline
 */
export class ToolCallPipeline {
  private collector: ToolCallCollector;
  private validator: ToolCallValidator;
  private normalizer: ToolCallNormalizer;
  private executor: ToolCallExecutor;

  constructor(allowedToolNames: string[] = []) {
    this.collector = new ToolCallCollector();
    this.validator = new ToolCallValidator(allowedToolNames);
    this.normalizer = new ToolCallNormalizer();
    this.executor = new ToolCallExecutor();
  }

  /**
   * Add tool call fragment
   */
  addFragment(index: number, fragment: Partial<ToolCallFragment>): void {
    this.collector.addFragment(index, fragment);
  }

  /**
   * Process all collected tool calls
   */
  async process(): Promise<PipelineResult> {
    logger.debug('Starting tool call pipeline processing');

    // Phase 1: Collect complete calls
    const candidates = this.collector.getCompleteCalls();
    logger.debug(`Collected ${candidates.length} complete tool calls`);

    // Phase 2: Validate calls
    const validatedCalls = this.validator.validateBatch(candidates);
    const validCalls = validatedCalls.filter((call) => call.isValid);
    const invalidCalls = validatedCalls.filter((call) => !call.isValid);
    logger.debug(
      `Validated ${validCalls.length} valid, ${invalidCalls.length} invalid tool calls`,
    );

    // Phase 3: Normalize calls
    const normalizedCalls = this.normalizer.normalizeBatch(validCalls);
    logger.debug(`Normalized ${normalizedCalls.length} tool calls`);

    // Phase 4: Execute calls
    const executionResults = await this.executor.executeBatch(normalizedCalls);
    const successfulResults = executionResults.filter(
      (result) => result.success,
    );
    const failedResults = executionResults.filter((result) => !result.success);
    logger.debug(
      `Executed ${successfulResults.length} successful, ${failedResults.length} failed tool calls`,
    );

    // Reset collector for next batch
    this.collector.reset();

    const result: PipelineResult = {
      executed: executionResults,
      normalized: normalizedCalls,
      failed: invalidCalls,
      stats: {
        collected: candidates.length,
        validated: validCalls.length,
        normalized: normalizedCalls.length,
        executed: successfulResults.length,
        failed: invalidCalls.length + failedResults.length,
      },
    };

    logger.debug(
      `Pipeline processing completed: ${JSON.stringify(result.stats)}`,
    );
    return result;
  }

  /**
   * Register tool function
   */
  registerTool(name: string, fn: ToolFunction): void {
    this.executor.registerTool(name, fn);
    this.validator.updateAllowedTools(this.executor.getRegisteredTools());
  }

  /**
   * Register tool functions in batch
   */
  registerTools(tools: Record<string, ToolFunction>): void {
    this.executor.registerTools(tools);
    this.validator.updateAllowedTools(this.executor.getRegisteredTools());
  }

  /**
   * Check if tool is registered
   */
  isToolRegistered(name: string): boolean {
    return this.executor.isToolRegistered(name);
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    return {
      collector: this.collector.getStats(),
      registeredTools: this.executor.getRegisteredTools().length,
    };
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
   * Reset pipeline state
   */
  reset(): void {
    this.collector.reset();
    logger.debug('ToolCallPipeline reset');
  }
}

// Import type from ToolCallCollector
import { ToolCallFragment } from './ToolCallCollector.js';
