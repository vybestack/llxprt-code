/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { BaseTool, type ToolResult, Kind } from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import type { ITodoService } from '../interfaces/ITodoService.js';
import type { IToolHost } from '../interfaces/IToolHost.js';
import { EmojiFilter, isEmojiFilterMode } from '../utils/EmojiFilter.js';

export interface TodoPauseParams {
  reason: string;
}

/**
 * Tool that allows AI models to explicitly pause the continuation loop when encountering errors or blockers.
 * Provides a clean exit mechanism from the continuation system.
 */
export class TodoPause extends BaseTool<TodoPauseParams, ToolResult> {
  static readonly Name = 'todo_pause';

  constructor(
    private readonly todoService?: ITodoService,
    private readonly toolHost?: IToolHost,
  ) {
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
    return `Pause AI continuation: ${this.getReasonForDisplay(params.reason)}`;
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
    if (params == null || typeof params !== 'object') {
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
    const reasonResult = this.filterReason(params.reason);
    if (reasonResult.blocked) {
      const message =
        reasonResult.errorMessage ?? 'Emojis detected in pause reason';
      return {
        llmContent: message,
        returnDisplay: message,
        error: { message },
      };
    }

    if (reasonResult.reason.length === 0) {
      const message = 'Pause reason is empty after emoji filtering';
      return {
        llmContent: message,
        returnDisplay: message,
        error: { message },
      };
    }

    const reason = reasonResult.reason;

    const store = this.todoService?.getTodoStore(this.context);
    if (store?.writePausedState) {
      await store.writePausedState(true);
    } else if (store?.setTodos && store.getTodos) {
      store.setTodos([
        ...store.getTodos(),
        { id: '__pause__', content: `pause: ${reason}`, status: 'pending' },
      ]);
    }

    const userMessage = `AI paused: ${reason}`;

    let llmMessage = `AI execution paused due to: ${reason}`;
    if (reasonResult.systemFeedback) {
      llmMessage += `

<system-reminder>
${reasonResult.systemFeedback}
</system-reminder>`;
    }

    return {
      llmContent: llmMessage,
      returnDisplay: userMessage,
    };
  }

  private getTodoPauseEmojiFilter(): EmojiFilter | null {
    if (!this.toolHost) {
      return null;
    }
    const raw = this.toolHost.getEphemeralSettings().emojifilter;
    const mode = isEmojiFilterMode(raw) ? raw : 'auto';
    return new EmojiFilter({ mode });
  }

  private getReasonForDisplay(reason: string): string {
    const result = this.filterReason(reason);
    if (result.blocked) {
      return result.errorMessage ?? 'Emojis detected in pause reason';
    }
    return result.reason.length > 0
      ? result.reason
      : 'Pause reason is empty after emoji filtering';
  }

  private filterReason(reason: string): {
    reason: string;
    blocked: boolean;
    errorMessage?: string;
    systemFeedback?: string;
  } {
    const filter = this.getTodoPauseEmojiFilter();
    if (!filter) {
      return { reason, blocked: false };
    }

    const result = filter.filterText(reason);
    if (result.blocked) {
      return {
        reason,
        blocked: true,
        errorMessage: result.error ?? 'Emojis detected in pause reason',
      };
    }

    return {
      reason: typeof result.filtered === 'string' ? result.filtered : reason,
      blocked: false,
      systemFeedback: result.systemFeedback,
    };
  }
}
