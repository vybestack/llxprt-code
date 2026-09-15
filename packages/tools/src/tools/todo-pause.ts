/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolResult,
  Kind,
  type LiveOutputUpdate,
} from './tools.js';
import type { ContextAwareTool, ToolContext } from '../types/tool-context.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
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
export class TodoPause
  extends BaseDeclarativeTool<TodoPauseParams, ToolResult>
  implements ContextAwareTool
{
  context?: ToolContext;
  static readonly Name = 'todo_pause';

  constructor(
    private readonly todoService: ITodoService,
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
        'The reason is limited to 500 characters and should clearly explain what specific issue is preventing progress. ' +
        'Stream any longer user-facing explanation as normal response text before or after calling this tool; ' +
        'do not place text longer than 500 characters in the reason argument.',
      Kind.Think,
      {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Concise explanation of why the task needs to be paused (e.g., missing file, configuration error, blocked dependency). ' +
              'Limited to a maximum of 500 characters; any longer user-facing explanation must be streamed as normal response text separately, not placed in this argument.',
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

  protected override validateToolParamValues(
    params: TodoPauseParams,
  ): string | null {
    return params.reason.length > 500
      ? 'reason exceeds maximum length of 500 characters'
      : null;
  }

  protected createInvocation(
    params: TodoPauseParams,
    messageBus?: IToolMessageBus,
  ): TodoPauseInvocation {
    return new TodoPauseInvocation(
      this.todoService,
      params,
      this.context,
      messageBus,
      this.toolHost,
    );
  }
}

class TodoPauseInvocation extends BaseToolInvocation<
  TodoPauseParams,
  ToolResult
> {
  constructor(
    private readonly todoService: ITodoService,
    params: TodoPauseParams,
    private readonly context: ToolContext | undefined,
    messageBus?: IToolMessageBus,
    private readonly toolHost?: IToolHost,
  ) {
    super(params, messageBus, TodoPause.Name);
  }

  override getDescription(): string {
    return `Pause AI continuation: ${this.getReasonForDisplay(this.params.reason)}`;
  }

  async execute(
    _signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    const reasonResult = this.filterReason(this.params.reason);
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

    const store = this.todoService.getTodoStore(this.context);
    if (store.writePausedState) {
      await store.writePausedState(true);
    } else if (store.setTodos && store.getTodos) {
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
