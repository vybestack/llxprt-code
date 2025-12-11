/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { BaseTool, type ToolResult, Kind } from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

export interface TodoPauseParams {
  reason: string;
}

/**
 * Tool that allows AI models to explicitly pause the continuation loop when encountering errors or blockers.
 * Provides a clean exit mechanism from the continuation system.
 */
export class TodoPause extends BaseTool<TodoPauseParams, ToolResult> {
  static readonly Name = 'todo_pause';

  constructor() {
    super(
      TodoPause.Name,
      'TodoPause',
      'Pause the current todo continuation when encountering errors or blockers. ' +
        'Use this tool when required files or resources are missing, configuration issues prevent progress, ' +
        'dependencies are blocking completion, or unexpected errors occur that require human intervention. ' +
        'DO NOT use this tool for normal task completion (use todo_write to update status instead), ' +
        'requesting clarification (continue with your best understanding), or minor issues that can be worked around. ' +
        'The reason should clearly explain what specific issue is preventing progress.',
      Kind.Think,
      {
        type: Type.OBJECT,
        properties: {
          reason: {
            type: Type.STRING,
            description:
              'Explanation of why the task needs to be paused (e.g., missing file, configuration error, blocked dependency)',
            minLength: 1,
            maxLength: 500,
          },
        },
        required: ['reason'],
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  override getDescription(params: TodoPauseParams): string {
    return `Pause AI continuation: ${params.reason}`;
  }

  override validateToolParams(
    params: unknown,
  ): (string & { message: string }) | null {
    // First validate against schema
    const schemaError = SchemaValidator.validate(
      this.schema.parameters,
      params,
    );
    if (schemaError) {
      const errorString = new String(schemaError) as string & {
        message: string;
      };
      errorString.message = schemaError;
      return errorString;
    }

    // Type guard to ensure params has the expected structure
    if (!params || typeof params !== 'object') {
      const errorString = new String('params must be an object') as string & {
        message: string;
      };
      errorString.message = 'params must be an object';
      return errorString;
    }

    const typedParams = params as Record<string, unknown>;

    // Check if reason property exists
    if (!('reason' in typedParams)) {
      const errorString = new String(
        'reason parameter is required',
      ) as string & { message: string };
      errorString.message = 'reason parameter is required';
      return errorString;
    }

    // Check if reason is a string
    if (typeof typedParams.reason !== 'string') {
      const errorString = new String('reason must be a string') as string & {
        message: string;
      };
      errorString.message = 'reason must be a string';
      return errorString;
    }

    const reason = typedParams.reason;

    // Check if reason is empty
    if (reason.length === 0) {
      const errorString = new String(
        'reason is required and cannot be empty',
      ) as string & { message: string };
      errorString.message = 'reason is required and cannot be empty';
      return errorString;
    }

    // Check if reason exceeds maximum length
    if (reason.length > 500) {
      const errorString = new String(
        'reason exceeds maximum length of 500 characters',
      ) as string & { message: string };
      errorString.message = 'reason exceeds maximum length of 500 characters';
      return errorString;
    }

    return null;
  }

  async execute(
    params: TodoPauseParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const reason = params.reason;

    // Format the user-friendly message
    const userMessage = `AI paused: ${reason}`;

    // Format the LLM content message
    const llmMessage = `AI execution paused due to: ${reason}`;

    return {
      llmContent: llmMessage,
      returnDisplay: userMessage,
    };
  }
}
