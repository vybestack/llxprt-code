/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { BaseTool, type ToolResult, Kind } from './tools.js';
import { type Todo, TodoArraySchema } from '../types/todo-schemas.js';
import { TodoStore, DEFAULT_AGENT_ID } from './todo-store.js';
import { TodoReminderService } from '../utils/todoReminderService.js';
import { todoEvents, type TodoUpdateEvent } from './todo-events.js';
import { TodoContextTracker } from '../utils/todoContextTracker.js';
import { formatTodoListForDisplay } from '../utils/todoFormatter.js';
import type { ITodoService } from '../interfaces/ITodoService.js';
import type { IToolHost } from '../interfaces/IToolHost.js';
import { EmojiFilter, isEmojiFilterMode } from '../utils/EmojiFilter.js';

export interface TodoWriteParams {
  todos: Todo[];
}

export class TodoWrite extends BaseTool<TodoWriteParams, ToolResult> {
  static readonly Name = 'todo_write';

  private static readonly SCHEMA = {
    type: Type.OBJECT,
    properties: {
      todos: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: {
              type: Type.STRING,
              description: 'Unique identifier for the todo item',
            },
            content: {
              type: Type.STRING,
              description: 'Description of the todo item',
              minLength: 1,
            },
            status: {
              type: Type.STRING,
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status of the todo item',
            },
            subtasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: {
                    type: Type.STRING,
                    description: 'Unique identifier for the subtask',
                  },
                  content: {
                    type: Type.STRING,
                    description: 'Description of the subtask',
                    minLength: 1,
                  },
                  toolCalls: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: {
                          type: Type.STRING,
                          description: 'Unique identifier for the tool call',
                        },
                        name: {
                          type: Type.STRING,
                          description: 'Name of the tool being called',
                        },
                        parameters: {
                          type: Type.OBJECT,
                          description: 'Parameters for the tool call',
                        },
                      },
                      required: ['id', 'name', 'parameters'],
                    },
                    description: 'Tool calls associated with the subtask',
                  },
                },
                required: ['id', 'content'],
              },
              description: 'Subtasks associated with this todo',
            },
          },
          required: ['id', 'content', 'status'],
        },
        description: 'The updated todo list',
      },
    },
    required: ['todos'],
  } as const;

  constructor(
    private readonly todoService?: ITodoService,
    private readonly toolHost?: IToolHost,
  ) {
    super(
      TodoWrite.Name,
      'TodoWrite',
      'Create and manage a structured task list for the current coding session. Updates the entire todo list.',
      Kind.Think,
      TodoWrite.SCHEMA,
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  override getDescription(params: TodoWriteParams): string {
    return `Update todo list with ${params.todos.length} items`;
  }

  // Emit an update event and track the active in-progress item.
  private trackInteractiveUpdate(
    todos: Todo[],
    sessionId: string,
    agentId: string | undefined,
  ): void {
    const scopedAgentId = agentId ?? DEFAULT_AGENT_ID;
    const inProgressTodo = todos.find((todo) => todo.status === 'in_progress');
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      scopedAgentId,
    );
    contextTracker.setActiveTodo(inProgressTodo ? inProgressTodo.id : null);
    this.emitTodoUpdated(todos, sessionId, scopedAgentId);
  }

  private emitTodoUpdated(
    todos: Todo[],
    sessionId: string,
    agentId: string | undefined,
  ): void {
    const event: TodoUpdateEvent = {
      sessionId,
      agentId,
      todos,
      timestamp: new Date(),
    };
    todoEvents.emitTodoUpdated(event);
  }

  async execute(
    params: TodoWriteParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const normalizedTodos = this.normalizeTodos(params.todos);

    // Validate todos with Zod schema
    const result = TodoArraySchema.safeParse(normalizedTodos);
    if (!result.success) {
      const error = result.error.errors[0];
      throw new Error(
        `Validation error: ${error.path.join('.')} - ${error.message}`,
      );
    }
    const emojiResult = this.applyEmojiFilter(result.data);
    if (emojiResult.blocked) {
      return {
        llmContent: emojiResult.errorMessage ?? 'Emojis detected in content',
        returnDisplay: emojiResult.errorMessage ?? 'Emojis detected in content',
        error: {
          message: emojiResult.errorMessage ?? 'Emojis detected in content',
        },
      };
    }

    const revalidation = TodoArraySchema.safeParse(emojiResult.filtered);
    if (!revalidation.success) {
      const err = revalidation.error.errors[0];
      const msg = `Emoji filtering produced invalid todo content: ${err.path.join('.')} - ${err.message}`;
      return {
        llmContent: msg,
        returnDisplay: msg,
        error: { message: msg },
      };
    }
    const todos = revalidation.data;

    // Get session and agent IDs from context
    const sessionId = this.context?.sessionId ?? 'default';
    const agentId = this.context?.agentId;

    const serviceStore = this.todoService?.getTodoStore(this.context);

    // Read old todos for diff tracking
    const rawOldTodos = serviceStore?.readTodos
      ? await serviceStore.readTodos()
      : serviceStore?.getTodos
        ? serviceStore.getTodos()
        : await new TodoStore(sessionId, agentId).readTodos();
    const oldTodos = rawOldTodos as Todo[];

    // Write new todos
    if (serviceStore?.writeTodos) {
      await serviceStore.writeTodos(todos);
    } else if (serviceStore?.setTodos) {
      serviceStore.setTodos(todos);
    } else {
      await new TodoStore(sessionId, agentId).writeTodos(todos);
    }

    const reminderService = this.todoService?.getReminderService();
    const localReminderService = new TodoReminderService();

    // Calculate state change
    const stateChange =
      reminderService?.calculateStateChange?.(oldTodos, todos) ??
      localReminderService.calculateStateChange(oldTodos, todos);

    const shouldGenerateReminder =
      reminderService?.shouldGenerateReminder?.(stateChange) ??
      localReminderService.shouldGenerateReminder(stateChange) ??
      false;

    // Generate reminder if needed
    let reminder: string | null = null;
    if (shouldGenerateReminder) {
      reminder =
        reminderService?.getReminderForStateChange?.(stateChange) ??
        localReminderService.getReminderForStateChange(stateChange) ??
        null;
    }

    // Set active task ID and emit event if in interactive mode
    if (this.context?.interactiveMode === true) {
      const scopedAgentId =
        agentId ?? this.todoService?.getDefaultAgentId() ?? DEFAULT_AGENT_ID;
      const serviceTracker = this.todoService?.getContextTracker(this.context);
      if (serviceTracker?.setActiveTodo) {
        const inProgressTodo = todos.find(
          (todo) => todo.status === 'in_progress',
        );
        serviceTracker.setActiveTodo(inProgressTodo ? inProgressTodo.id : null);
        this.emitTodoUpdated(todos, sessionId, scopedAgentId);
      } else {
        this.trackInteractiveUpdate(todos, sessionId, scopedAgentId);
      }
    }

    const formattedOutput = formatTodoListForDisplay(todos);

    const statistics = this.calculateStatistics(todos);
    const nextAction = this.determineNextAction(todos);

    let llmContent = formattedOutput;
    if (emojiResult.systemFeedback) {
      llmContent += `

<system-reminder>
${emojiResult.systemFeedback}
</system-reminder>`;
    }

    return {
      llmContent,
      returnDisplay: formattedOutput,
      metadata: {
        stateChanged: shouldGenerateReminder,
        todosAdded: stateChange.added.length,
        todosRemoved: stateChange.removed.length,
        statusChanged: stateChange.statusChanged.length,
        statistics,
        nextAction,
        reminder: reminder ?? undefined,
      },
    };
  }

  private normalizeTodos(rawTodos: TodoWriteParams['todos']): Todo[] {
    const normalized = rawTodos.map((todo, index) => {
      const normalizedId =
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Todo input payload data.
        todo?.id !== undefined &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Todo input payload data.
        todo?.id !== null &&
        `${todo.id}`.trim() !== ''
          ? String(todo.id)
          : String(index + 1);

      const rawSubtasks = todo?.subtasks;
      const hasSubtasks = Array.isArray(rawSubtasks);
      const normalizedSubtasks = hasSubtasks
        ? rawSubtasks.map((subtask, subIndex) => {
            const subtaskId =
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Todo input payload data.
              subtask?.id !== undefined &&
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Todo input payload data.
              subtask?.id !== null &&
              `${subtask.id}`.trim() !== ''
                ? String(subtask.id)
                : `${normalizedId}-${subIndex + 1}`;
            return {
              ...subtask,
              id: subtaskId,
            };
          })
        : undefined;

      const normalized: Todo = {
        ...todo,
        id: normalizedId,
        status: todo.status ?? 'pending',
      };
      if (hasSubtasks) {
        normalized.subtasks = normalizedSubtasks;
      }
      return normalized;
    });
    return this.enforceOneInProgress(normalized);
  }

  private enforceOneInProgress(todos: Todo[]): Todo[] {
    const inProgressIndices = todos
      .map((todo, index) => (todo.status === 'in_progress' ? index : -1))
      .filter((index) => index !== -1);

    if (inProgressIndices.length <= 1) {
      return todos;
    }

    const lastInProgressIndex = inProgressIndices[inProgressIndices.length - 1];
    return todos.map((todo, index) => {
      if (todo.status === 'in_progress' && index !== lastInProgressIndex) {
        return { ...todo, status: 'pending' as const };
      }
      return todo;
    });
  }

  private calculateStatistics(todos: Todo[]): {
    total: number;
    inProgress: number;
    pending: number;
    completed: number;
  } {
    return {
      total: todos.length,
      inProgress: todos.filter((t) => t.status === 'in_progress').length,
      pending: todos.filter((t) => t.status === 'pending').length,
      completed: todos.filter((t) => t.status === 'completed').length,
    };
  }

  private determineNextAction(todos: Todo[]): {
    type: 'continue' | 'start' | 'all-complete';
    taskId?: string;
    taskContent?: string;
  } {
    // Check if any tasks are in progress - return first one (preserves LLM order)
    const inProgressTasks = todos.filter((t) => t.status === 'in_progress');
    if (inProgressTasks.length > 0) {
      const task = inProgressTasks[0];
      return {
        type: 'continue',
        taskId: task.id,
        taskContent: task.content,
      };
    }

    // Check if any tasks are pending - return first one (preserves LLM order)
    const pendingTasks = todos.filter((t) => t.status === 'pending');
    if (pendingTasks.length > 0) {
      const task = pendingTasks[0];
      return {
        type: 'start',
        taskId: task.id,
        taskContent: task.content,
      };
    }

    // All tasks are completed
    return { type: 'all-complete' };
  }

  private getTodoEmojiFilter(): EmojiFilter | null {
    if (!this.toolHost) {
      return null;
    }
    const raw = this.toolHost.getEphemeralSettings?.().emojifilter;
    const mode = isEmojiFilterMode(raw) ? raw : 'auto';
    return new EmojiFilter({ mode });
  }

  private applyEmojiFilter(todos: Todo[]): {
    filtered: Todo[];
    blocked: boolean;
    errorMessage?: string;
    systemFeedback?: string;
  } {
    const filter = this.getTodoEmojiFilter();
    if (!filter) {
      return { filtered: todos, blocked: false };
    }

    let blocked = false;
    let errorMessage: string | undefined;
    const feedbackParts: Set<string> = new Set();

    const filteredTodos = todos.map((todo) => {
      const contentResult = filter.filterText(todo.content);
      if (contentResult.blocked) {
        blocked = true;
        errorMessage = contentResult.error ?? 'Emojis detected in todo content';
      }
      if (contentResult.systemFeedback)
        feedbackParts.add(contentResult.systemFeedback);

      const filteredSubtasks = todo.subtasks?.map((subtask) => {
        const subResult = filter.filterText(subtask.content);
        if (subResult.blocked) {
          blocked = true;
          errorMessage =
            subResult.error ?? 'Emojis detected in subtask content';
        }
        if (subResult.systemFeedback)
          feedbackParts.add(subResult.systemFeedback);
        const subFiltered = subResult.filtered;
        return {
          ...subtask,
          content:
            typeof subFiltered === 'string' ? subFiltered : subtask.content,
        };
      });

      const todoFiltered = contentResult.filtered;
      const filteredTodo: Todo = {
        ...todo,
        content: typeof todoFiltered === 'string' ? todoFiltered : todo.content,
      };
      if (todo.subtasks) {
        filteredTodo.subtasks = filteredSubtasks;
      }
      return filteredTodo;
    });

    return {
      filtered: filteredTodos,
      blocked,
      errorMessage,
      systemFeedback:
        feedbackParts.size > 0
          ? Array.from(feedbackParts).join(' ')
          : undefined,
    };
  }
}
