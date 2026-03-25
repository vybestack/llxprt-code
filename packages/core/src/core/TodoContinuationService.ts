/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type PartListUnion, type Part } from '@google/genai';
import { GeminiEventType } from './turn.js';
import type { ServerGeminiStreamEvent, ToolCallResponseInfo } from './turn.js';
import type { Config } from '../config/config.js';
import { DEFAULT_AGENT_ID } from './turn.js';

import type { ComplexityAnalysisResult } from '../services/complexity-analyzer.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { TodoStore } from '../tools/todo-store.js';
import type { Todo } from '../tools/todo-schemas.js';

const COMPLEXITY_ESCALATION_TURN_THRESHOLD = 3;
const TODO_PROMPT_SUFFIX = 'Use TODO List to organize this effort.';

function toPartArray(request: PartListUnion): Part[] {
  if (Array.isArray(request)) {
    return [...request] as Part[];
  }
  if (typeof request === 'string') {
    return [{ text: request }];
  }
  if ('text' in request) {
    return [request];
  }
  return [];
}

export enum PostTurnAction {
  Finish = 'finish',
  ThinkingOnlyRetry = 'thinking-only-retry',
  RetryWithReminder = 'retry-with-reminder',
}

export interface PostTurnContext {
  hadToolCalls: boolean;
  hadThinking: boolean;
  hadContent: boolean;
  todoPauseSeen: boolean;
  retryCount: number;
  maxRetries: number;
  activeTodos: Todo[];
  hasPendingReminder: boolean;
}

export class TodoContinuationService {
  private todoToolsAvailable = false;
  private lastComplexitySuggestionTime: number = 0;
  private readonly complexitySuggestionCooldown: number;
  private lastTodoToolTurn?: number;
  consecutiveComplexTurns = 0;
  private lastComplexitySuggestionTurn?: number;
  toolActivityCount = 0;
  toolCallReminderLevel: 'none' | 'base' | 'escalated' = 'none';
  lastTodoSnapshot?: Todo[];

  private readonly todoReminderService: TodoReminderService;
  private readonly config: Config;

  constructor({
    config,
    todoReminderService,
    complexitySuggestionCooldown,
  }: {
    config: Config;
    todoReminderService: TodoReminderService;
    complexitySuggestionCooldown: number;
  }) {
    this.config = config;
    this.todoReminderService = todoReminderService;
    this.complexitySuggestionCooldown = complexitySuggestionCooldown;
  }

  updateTodoToolAvailabilityFromDeclarations(
    declarations: Array<{ name?: string }>,
  ): void {
    const normalizedNames = new Set(
      declarations
        .map((decl) => decl?.name)
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.toLowerCase()),
    );

    this.todoToolsAvailable =
      normalizedNames.has('todo_write') && normalizedNames.has('todo_read');
  }

  processComplexityAnalysis(
    analysis: ComplexityAnalysisResult,
    sessionTurnCount: number,
  ): string | undefined {
    if (!this.todoToolsAvailable) {
      this.consecutiveComplexTurns = 0;
      return undefined;
    }

    if (!analysis.isComplex || !analysis.shouldSuggestTodos) {
      this.consecutiveComplexTurns = 0;
      return undefined;
    }

    this.consecutiveComplexTurns += 1;

    const alreadySuggestedThisTurn =
      this.lastComplexitySuggestionTurn === sessionTurnCount;
    const currentTime = Date.now();
    const withinCooldown =
      currentTime - this.lastComplexitySuggestionTime <
      this.complexitySuggestionCooldown;

    if (alreadySuggestedThisTurn || withinCooldown) {
      return undefined;
    }

    const reminder = this.shouldEscalateReminder(sessionTurnCount)
      ? this.todoReminderService.getEscalatedComplexTaskSuggestion(
          analysis.detectedTasks,
        )
      : this.todoReminderService.getComplexTaskSuggestion(
          analysis.detectedTasks,
        );

    this.lastComplexitySuggestionTime = currentTime;
    this.lastComplexitySuggestionTurn = sessionTurnCount;

    return reminder;
  }

  shouldEscalateReminder(sessionTurnCount: number): boolean {
    if (this.consecutiveComplexTurns < COMPLEXITY_ESCALATION_TURN_THRESHOLD) {
      return false;
    }

    const turnsSinceTodo =
      this.lastTodoToolTurn === undefined
        ? Number.POSITIVE_INFINITY
        : sessionTurnCount - this.lastTodoToolTurn;

    return turnsSinceTodo >= COMPLEXITY_ESCALATION_TURN_THRESHOLD;
  }

  isTodoToolCall(name: unknown): boolean {
    if (typeof name !== 'string') {
      return false;
    }
    const normalized = name.toLowerCase();
    return normalized === 'todo_write' || normalized === 'todo_read';
  }

  appendTodoSuffixToRequest(request: PartListUnion): PartListUnion {
    const parts = toPartArray(request);

    const suffixAlreadyPresent = parts.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string' &&
        part.text.includes(TODO_PROMPT_SUFFIX),
    );

    if (suffixAlreadyPresent) {
      return parts;
    }

    parts.push({ text: TODO_PROMPT_SUFFIX } as Part);
    return parts;
  }

  recordModelActivity(event: ServerGeminiStreamEvent): void {
    if (!this.todoToolsAvailable) {
      return;
    }
    if (event.type !== GeminiEventType.ToolCallResponse) {
      return;
    }

    this.toolActivityCount += 1;

    if (this.toolActivityCount > 4) {
      this.toolCallReminderLevel = 'escalated';
    } else if (
      this.toolActivityCount === 4 &&
      this.toolCallReminderLevel === 'none'
    ) {
      this.toolCallReminderLevel = 'base';
    }
  }

  async readTodoSnapshot(): Promise<Todo[]> {
    try {
      const sessionId = this.config.getSessionId();
      const store = new TodoStore(sessionId, DEFAULT_AGENT_ID);
      return await store.readTodos();
    } catch (_error) {
      return [];
    }
  }

  getActiveTodos(todos: Todo[]): Todo[] {
    const inProgress = todos.filter((todo) => todo.status === 'in_progress');
    const pending = todos.filter((todo) => todo.status === 'pending');
    return [...inProgress, ...pending];
  }

  areTodoSnapshotsEqual(a: readonly Todo[], b: readonly Todo[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const normalize = (todos: readonly Todo[]) =>
      todos
        .map((todo) => ({
          id: `${todo.id ?? ''}`,
          status: (todo.status ?? 'pending').toLowerCase(),
          content: todo.content ?? '',
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    const normalizedA = normalize(a);
    const normalizedB = normalize(b);
    return normalizedA.every(
      (todo, index) =>
        JSON.stringify(todo) === JSON.stringify(normalizedB[index]),
    );
  }

  async getTodoReminderForCurrentState(options?: {
    todoSnapshot?: Todo[];
    activeTodos?: Todo[];
    escalate?: boolean;
  }): Promise<{
    reminder: string | null;
    todos: Todo[];
    activeTodos: Todo[];
  }> {
    const todos = options?.todoSnapshot ?? (await this.readTodoSnapshot());
    const activeTodos = options?.activeTodos ?? this.getActiveTodos(todos);

    let reminder: string | null = null;
    if (todos.length === 0) {
      reminder = this.todoReminderService.getCreateListReminder([]);
    } else if (activeTodos.length > 0) {
      reminder = options?.escalate
        ? this.todoReminderService.getEscalatedActiveTodoReminder(
            activeTodos[0],
          )
        : this.todoReminderService.getUpdateActiveTodoReminder(activeTodos[0]);
    }

    return { reminder, todos, activeTodos };
  }

  appendSystemReminderToRequest(
    request: PartListUnion,
    reminderText: string,
  ): PartListUnion {
    const parts = toPartArray(request);
    const alreadyPresent = parts.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string' &&
        part.text === reminderText,
    );
    if (!alreadyPresent) {
      parts.push({ text: reminderText } as Part);
    }
    return parts;
  }

  shouldDeferStreamEvent(event: ServerGeminiStreamEvent): boolean {
    return (
      event.type === GeminiEventType.Content ||
      event.type === GeminiEventType.Finished ||
      event.type === GeminiEventType.Citation
    );
  }

  isTodoPauseResponse(response: ToolCallResponseInfo | undefined): boolean {
    if (!response?.responseParts) {
      return false;
    }
    return response.responseParts.some((part) => {
      if (
        part &&
        typeof part === 'object' &&
        'functionResponse' in part &&
        part.functionResponse &&
        typeof part.functionResponse === 'object'
      ) {
        const name = (part.functionResponse as { name?: unknown }).name;
        return typeof name === 'string' && name.toLowerCase() === 'todo_pause';
      }
      return false;
    });
  }

  classifyPostTurnAction(context: PostTurnContext): PostTurnAction {
    const {
      hadToolCalls,
      hadThinking,
      hadContent,
      todoPauseSeen,
      retryCount,
      maxRetries,
      activeTodos,
      hasPendingReminder,
    } = context;

    if (hadToolCalls) {
      return PostTurnAction.Finish;
    }

    if (hadThinking && !hadContent && !hadToolCalls) {
      if (retryCount >= maxRetries) {
        return PostTurnAction.Finish;
      }
      return PostTurnAction.ThinkingOnlyRetry;
    }

    if (todoPauseSeen) {
      return PostTurnAction.Finish;
    }

    const todosStillPending = activeTodos.length > 0;

    if (!todosStillPending && !hasPendingReminder) {
      return PostTurnAction.Finish;
    }

    if (retryCount >= maxRetries) {
      return PostTurnAction.Finish;
    }

    return PostTurnAction.RetryWithReminder;
  }

  buildFollowUpReminder(
    latestSnapshot: Todo[],
    activeTodos: Todo[],
  ): string | undefined {
    const previousSnapshot = this.lastTodoSnapshot ?? [];
    const snapshotUnchanged = this.areTodoSnapshotsEqual(
      previousSnapshot,
      latestSnapshot,
    );

    let reminder: string | null = null;
    if (activeTodos.length > 0) {
      reminder = snapshotUnchanged
        ? this.todoReminderService.getEscalatedActiveTodoReminder(
            activeTodos[0],
          )
        : this.todoReminderService.getUpdateActiveTodoReminder(activeTodos[0]);
    } else if (latestSnapshot.length === 0) {
      reminder = this.todoReminderService.getCreateListReminder([]);
    }

    return reminder ?? undefined;
  }

  resetActivityCounters(): void {
    this.toolCallReminderLevel = 'none';
    this.toolActivityCount = 0;
    this.consecutiveComplexTurns = 0;
    this.lastComplexitySuggestionTime = 0;
    this.lastComplexitySuggestionTurn = undefined;
    this.lastTodoToolTurn = undefined;
    this.lastTodoSnapshot = undefined;
  }

  setLastTodoToolTurn(turn: number): void {
    this.lastTodoToolTurn = turn;
  }

  async applyPendingReminder(request: PartListUnion): Promise<PartListUnion> {
    if (this.toolCallReminderLevel === 'none') return request;

    const reminderResult = await this.getTodoReminderForCurrentState({
      todoSnapshot: this.lastTodoSnapshot,
      escalate: this.toolCallReminderLevel === 'escalated',
    });

    if (reminderResult.reminder) {
      const parts = toPartArray(request);
      const textOnlyParts = parts.filter(
        (part) =>
          typeof part === 'object' &&
          !('functionCall' in part) &&
          !('functionResponse' in part),
      );
      request = this.appendSystemReminderToRequest(
        textOnlyParts,
        reminderResult.reminder,
      );
      this.lastTodoSnapshot = reminderResult.todos;
    }

    this.toolCallReminderLevel = 'none';
    this.toolActivityCount = 0;
    return request;
  }
}
