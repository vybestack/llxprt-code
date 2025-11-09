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
 * ToolCallExecutor - Execute tool calls
 *
 * Responsible for executing normalized tool calls and handling execution results.
 */

import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallExecutor');

export interface ToolExecutionResult {
  index: number;
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
}

export interface ToolFunction {
  (args: Record<string, unknown>): Promise<unknown> | unknown;
}

/**
 * ToolCallExecutor - Responsible for executing tool calls
 */
export class ToolCallExecutor {
  private toolRegistry = new Map<string, ToolFunction>();

  /**
   * Register tool function
   */
  registerTool(name: string, fn: ToolFunction): void {
    this.toolRegistry.set(name, fn);
    logger.debug(`Registered tool: ${name}`);
  }

  /**
   * Batch register tool functions
   */
  registerTools(tools: Record<string, ToolFunction>): void {
    for (const [name, fn] of Object.entries(tools)) {
      this.registerTool(name, fn);
    }
  }

  /**
   * Execute single tool call
   */
  async execute(
    normalizedCall: NormalizedToolCall,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      const toolFn = this.toolRegistry.get(normalizedCall.name);
      if (!toolFn) {
        throw new Error(`Tool '${normalizedCall.name}' is not registered`);
      }

      logger.debug(
        `Executing tool call ${normalizedCall.index}: ${normalizedCall.name}`,
      );

      const result = await toolFn(normalizedCall.args);

      const executionTime = Date.now() - startTime;
      logger.debug(
        `Tool call ${normalizedCall.index} completed in ${executionTime}ms`,
      );

      return {
        index: normalizedCall.index,
        name: normalizedCall.name,
        success: true,
        result,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(`Tool call ${normalizedCall.index} failed: ${errorMessage}`);

      return {
        index: normalizedCall.index,
        name: normalizedCall.name,
        success: false,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
   * Batch execute tool calls
   */
  async executeBatch(
    normalizedCalls: NormalizedToolCall[],
  ): Promise<ToolExecutionResult[]> {
    // Execute sequentially to avoid resource conflicts
    const results: ToolExecutionResult[] = [];

    for (const call of normalizedCalls) {
      const result = await this.execute(call);
      results.push(result);
    }

    return results;
  }

  /**
   * Check if tool is registered
   */
  isToolRegistered(name: string): boolean {
    return this.toolRegistry.has(name);
  }

  /**
   * Get list of registered tool names
   */
  getRegisteredTools(): string[] {
    return Array.from(this.toolRegistry.keys());
  }

  /**
   * Remove registered tool
   */
  unregisterTool(name: string): boolean {
    const removed = this.toolRegistry.delete(name);
    if (removed) {
      logger.debug(`Unregistered tool: ${name}`);
    }
    return removed;
  }

  /**
   * Clear all registered tools
   */
  clearTools(): void {
    this.toolRegistry.clear();
    logger.debug('Cleared all registered tools');
  }
}

// Import type from ToolCallNormalizer
import { NormalizedToolCall } from './ToolCallNormalizer.js';
