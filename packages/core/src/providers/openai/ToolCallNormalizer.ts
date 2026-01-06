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
 * ToolCallNormalizer - Normalizes tool calls
 *
 * Responsible for normalizing tool calls to standard format,
 * preparing them for Core layer execution.
 */

import { DebugLogger } from '../../debug/index.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallNormalizer');

export interface NormalizedToolCall {
  index: number;
  id?: string;
  name: string;
  args: Record<string, unknown>;
  originalArgs?: string;
}

// Local interface to replace dependency on ToolCallValidator
export interface ValidatedToolCall {
  index: number;
  id?: string;
  name: string;
  args?: string;
  isValid: boolean;
  validationErrors: string[];
}

/**
 * ToolCallNormalizer - Responsible for normalizing tool calls
 */
export class ToolCallNormalizer {
  /**
   * Normalize tool calls
   */
  normalize(validatedCall: ValidatedToolCall): NormalizedToolCall | null {
    if (!validatedCall.isValid) {
      logger.error(`Cannot normalize invalid tool call ${validatedCall.index}`);
      return null;
    }

    try {
      const normalized: NormalizedToolCall = {
        index: validatedCall.index,
        id: validatedCall.id,
        name: this.normalizeToolName(validatedCall.name),
        args: this.parseArgs(validatedCall.args),
        originalArgs: validatedCall.args,
      };

      logger.debug(
        `Normalized tool call ${validatedCall.index}: ${normalized.name}`,
      );
      return normalized;
    } catch (error) {
      logger.error(
        `Failed to normalize tool call ${validatedCall.index}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Normalize tool calls in batch
   */
  normalizeBatch(validatedCalls: ValidatedToolCall[]): NormalizedToolCall[] {
    return validatedCalls
      .map((call) => this.normalize(call))
      .filter((call): call is NormalizedToolCall => call !== null);
  }

  /**
   * Normalize tool name
   *
   * Handles Kimi-K2 style malformed tool names where the model concatenates
   * prefixes like "functions" or "call_functions" with the actual tool name:
   * - "functionslist_directory" -> "list_directory"
   * - "call_functionslist_directory6" -> "list_directory"
   * - "call_functionssearch_file_content9" -> "search_file_content"
   */
  private normalizeToolName(name: string): string {
    let normalized = name.trim();

    // Strip Kimi-K2 style prefixes where model concatenates "functions" or "call_functions"
    // with the actual tool name (e.g., "functionslist_directory" -> "list_directory")
    // Pattern: (call_)?functions<actual_tool_name><optional_number>
    const kimiPrefixMatch = /^(?:call_)?functions([a-z_]+[a-z])(\d*)$/i.exec(
      normalized,
    );
    if (kimiPrefixMatch) {
      normalized = kimiPrefixMatch[1];
      logger.debug(
        `Stripped Kimi-style prefix from tool name: "${name}" -> "${normalized}"`,
      );
    }

    return normalized.toLowerCase();
  }

  /**
   * Parse arguments string to object using processToolParameters
   */
  private parseArgs(args?: string): Record<string, unknown> {
    if (!args || !args.trim()) {
      return {};
    }

    // Use processToolParameters to handle double-escaping and format-specific issues
    // Let it auto-detect issues instead of relying on format parameter
    const processed = processToolParameters(args, 'unknown_tool');

    // Normalize the result to a Record<string, unknown>
    if (typeof processed === 'object' && processed !== null) {
      return processed as Record<string, unknown>;
    }

    if (typeof processed === 'string') {
      return { value: processed };
    }

    return {};
  }

  /**
   * Validate normalization result
   */
  validateNormalized(call: NormalizedToolCall): boolean {
    if (!call.name || typeof call.name !== 'string') {
      return false;
    }

    if (!call.args || typeof call.args !== 'object') {
      return false;
    }

    return true;
  }
}
