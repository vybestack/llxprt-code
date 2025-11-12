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
 * Responsible for normalizing validated tool calls to standard format,
 * preparing them for execution phase.
 */

import { DebugLogger } from '../../debug/index.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallNormalizer');

export interface NormalizedToolCall {
  index: number;
  name: string;
  args: Record<string, unknown>;
  originalArgs?: string;
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
   */
  private normalizeToolName(name: string): string {
    // Remove leading/trailing whitespace and convert to lowercase
    return name.trim().toLowerCase();
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
    const processed = processToolParameters(args, 'unknown_tool', 'unknown');

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

// Import type from ToolCallValidator
import { ValidatedToolCall } from './ToolCallValidator.js';
