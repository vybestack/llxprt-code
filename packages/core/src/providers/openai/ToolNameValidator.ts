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
 * Tool Name Validator for OpenAI Provider
 *
 * Based on the mature logic from subagent.ts normalizeToolName function,
 * but adapted for OpenAI provider context with enhanced error handling.
 */

import { DebugLogger } from '../../debug/index.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import {
  normalizeToolName,
  findMatchingTool,
} from '../../tools/toolNameUtils.js';

export interface ToolNameValidationResult {
  name: string;
  warnings: string[];
  isValid: boolean;
}

export class ToolNameValidator {
  private logger: DebugLogger;

  constructor() {
    this.logger = new DebugLogger('llxprt:provider:openai:ToolNameValidator');
  }

  /**
   * Validates and normalizes a tool name from qwen model responses
   * Based on subagent.ts normalizeToolName but enhanced for OpenAI provider
   */
  validateToolName(
    rawName: string | undefined,
    detectedFormat: ToolFormat,
    availableToolNames: string[] = [],
  ): ToolNameValidationResult {
    const result: ToolNameValidationResult = {
      name: '',
      warnings: [],
      isValid: true,
    };

    // Step 1: Handle undefined/null/empty names
    if (!rawName || rawName.trim() === '') {
      result.name = 'undefined_tool_name';
      result.warnings.push('Empty or undefined tool name, using fallback');
      result.isValid = false;
      this.logger.debug(
        () => `Empty tool name detected, using fallback: ${result.name}`,
      );
      return result;
    }

    // Step 2: Attempt to normalize and validate against available tools
    const normalized = this.normalizeToolName(rawName);

    if (!normalized) {
      result.name = 'undefined_tool_name';
      result.warnings.push(
        `Unable to normalize tool name: "${rawName}", using fallback`,
      );
      result.isValid = false;
      return result;
    }

    // Step 3: Validate against available tool names if provided
    if (availableToolNames.length > 0) {
      const matchedTool = this.findMatchingTool(normalized, availableToolNames);
      if (matchedTool) {
        result.name = matchedTool;
        if (matchedTool !== rawName) {
          result.warnings.push(
            `Tool name normalized: "${rawName}" -> "${matchedTool}"`,
          );
        }
        return result;
      } else {
        result.name = 'undefined_tool_name';
        result.warnings.push(
          `Tool "${normalized}" not found in available tools, using fallback`,
        );
        result.isValid = false;
        return result;
      }
    }

    // Step 4: Return normalized name if no validation against available tools
    result.name = normalized;
    if (normalized !== rawName) {
      result.warnings.push(
        `Tool name normalized: "${rawName}" -> "${normalized}"`,
      );
    }

    return result;
  }

  /**
   * Normalize tool name using shared utility function
   */
  private normalizeToolName(name: string): string | null {
    return normalizeToolName(name);
  }

  /**
   * Find matching tool from available tools with fuzzy matching
   */
  private findMatchingTool = findMatchingTool;
}
