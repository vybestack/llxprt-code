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
 * ToolCallValidator - Validates tool call candidates
 *
 * Responsible for validating collected tool call candidates to ensure they are valid
 * and meet execution requirements.
 */

import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallValidator');

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidatedToolCall {
  index: number;
  name: string;
  args?: string;
  isValid: boolean;
  validationErrors: string[];
}

/**
 * ToolCallValidator - The verification tool calls the candidates.
 */
export class ToolCallValidator {
  private allowedToolNames: Set<string>;

  constructor(allowedToolNames: string[] = []) {
    this.allowedToolNames = new Set(allowedToolNames);
  }

  /**
   * Validate tool call candidate
   */
  validate(candidate: ToolCallCandidate): ValidatedToolCall {
    const result: ValidatedToolCall = {
      index: candidate.index,
      name: candidate.name || '',
      args: candidate.args,
      isValid: true,
      validationErrors: [],
    };

    const errors: string[] = [];

    // Check if name exists
    if (!candidate.name || !candidate.name.trim()) {
      errors.push('Tool call missing name');
      result.isValid = false;
    }

    // Check if name is in allowed list
    if (
      candidate.name &&
      this.allowedToolNames.size > 0 &&
      !this.allowedToolNames.has(candidate.name)
    ) {
      errors.push(`Tool name '${candidate.name}' is not in allowed list`);
      result.isValid = false;
    }

    // Check name format
    if (candidate.name && !this.isValidToolName(candidate.name)) {
      errors.push(`Tool name '${candidate.name}' contains invalid characters`);
      result.isValid = false;
    }

    // Remove strict JSON validation - let processToolParameters handle it
    // This prevents over-validation that blocks valid tool calls

    result.validationErrors = errors;

    if (!result.isValid) {
      logger.warn(
        `Tool call ${candidate.index} validation failed: ${errors.join(', ')}`,
      );
    } else {
      logger.debug(`Tool call ${candidate.index} validation passed`);
    }

    return result;
  }

  /**
   * Batch validate tool call candidates
   */
  validateBatch(candidates: ToolCallCandidate[]): ValidatedToolCall[] {
    return candidates.map((candidate) => this.validate(candidate));
  }

  /**
   * Check if tool name is valid
   */
  private isValidToolName(name: string): boolean {
    // Allow letters, numbers, underscores and hyphens
    return /^[a-zA-Z0-9_-]+$/.test(name);
  }

  /**
   * Update allowed tool names list
   */
  updateAllowedTools(allowedToolNames: string[]): void {
    this.allowedToolNames = new Set(allowedToolNames);
    logger.debug(`Updated allowed tool names: ${allowedToolNames.join(', ')}`);
  }
}

// Import type from ToolCallCollector
import { ToolCallCandidate } from './ToolCallCollector.js';
