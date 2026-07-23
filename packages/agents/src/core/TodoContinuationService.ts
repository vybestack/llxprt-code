/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  iContentFromAgentMessageInput,
  type AgentMessageInput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AgentEventType } from './turn.js';
import type { ServerAgentStreamEvent, ToolCallResponseInfo } from './turn.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DEFAULT_AGENT_ID } from './turn.js';

import type { ComplexityAnalysisResult } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import type { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { LocalTodoStore as TodoStore } from '@vybestack/llxprt-code-tools';
import type { Todo } from '@vybestack/llxprt-code-tools';

const COMPLEXITY_ESCALATION_TURN_THRESHOLD = 3;
const TODO_PROMPT_SUFFIX = 'Use TODO List to organize this effort.';

/**
 * Narrows a runtime `Part` to a text-bearing part. Runtime payloads from
 * providers can include null or malformed entries despite declared types.
 */
function asTextPart(part: ContentBlock): { text: string } | undefined {
  const candidate = part as unknown;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'text' in candidate &&
    typeof (candidate as { text: unknown }).text === 'string'
  ) {
    return candidate as { text: string };
  }
  return undefined;
}

/**
 * Extracts the function-response name from a Part if present. Runtime
 * payloads can include null or malformed entries despite declared types.
 */
function getToolResponseName(block: ContentBlock): string | undefined {
  if (block.type === 'tool_response') {
    return block.toolName;
  }
  return undefined;
}

/**
 * Normalizes a task-list entry for snapshot comparison. Runtime payloads may
 * omit or null out fields despite the declared type.
 */
/**
 * Structural accessor for a task-list entry's optional fields. Runtime
 * payloads may omit or null out fields despite the declared type. The
 * `as unknown as Record` widening is guarded by the entry input type (an
 * object), so the runtime shape is already object-typed before widening to
 * a string-keyed record.
 */
function taskEntryFields(todo: Todo): Record<string, unknown> {
  return todo as unknown as Record<string, unknown>;
}

/**
 * Converts a runtime task-list entry id (string, number, or missing) to a
 * stable string for snapshot comparison. Extracted to avoid a nested ternary.
 */
function taskEntryIdToString(rawId: unknown): string {
  if (typeof rawId === 'string') {
    return rawId;
  }
  if (typeof rawId === 'number') {
    return String(rawId);
  }
  return '';
}

function normalizeTodoForComparison(todo: Todo): {
  id: string;
  status: string;
  content: string;
} {
  const raw = taskEntryFields(todo);
  const rawStatus = raw['status'];
  const status =
    typeof rawStatus === 'string' && rawStatus.length > 0
      ? rawStatus.toLowerCase()
      : 'pending';
  const rawContent = raw['content'];
  const content = typeof rawContent === 'string' ? rawContent : '';
  const rawId = raw['id'];
  const id = taskEntryIdToString(rawId);
  return {
    id,
    status,
    content,
  };
}

function toContents(request: AgentMessageInput): IContent[] {
  return iContentFromAgentMessageInput(request).map((content) => ({
    ...content,
    blocks: [...content.blocks],
  }));
}

function appendTextToContents(
  request: AgentMessageInput,
  text: string,
  matches: (candidate: string) => boolean,
): IContent[] {
  const contents = toContents(request);
  if (
    contents.some((content) =>
      content.blocks.some((block) => {
        const textPart = asTextPart(block);
        return textPart !== undefined && matches(textPart.text);
      }),
    )
  ) {
    return contents;
  }
  let lastHuman: IContent | undefined;
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    if (contents[index].speaker === 'human') {
      lastHuman = contents[index];
      break;
    }
  }
  if (lastHuman !== undefined) {
    lastHuman.blocks.push({ type: 'text', text });
  } else {
    contents.push({ speaker: 'human', blocks: [{ type: 'text', text }] });
  }
  return contents;
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
  private readonly todoDataDirResolver: () => string;

  constructor({
    config,
    todoReminderService,
    complexitySuggestionCooldown,
    todoDataDirResolver,
  }: {
    config: Config;
    todoReminderService: TodoReminderService;
    complexitySuggestionCooldown: number;
    /**
     * Canonical task-list data directory resolver (wired to
     * `Storage.getGlobalDataDir()` at the composition root). Required: the
     * agents package no longer relies on a module-level global resolver or a
     * duplicate platform algorithm in the tools leaf package.
     */
    todoDataDirResolver: () => string;
  }) {
    this.config = config;
    this.todoReminderService = todoReminderService;
    this.complexitySuggestionCooldown = complexitySuggestionCooldown;
    this.todoDataDirResolver = todoDataDirResolver;
  }

  updateTodoToolAvailabilityFromDeclarations(
    declarations: Array<{ name?: string }>,
  ): void {
    const normalizedNames = new Set(
      declarations
        .map((decl) => (decl as { name?: string } | null)?.name)
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

  appendTodoSuffixToRequest(request: AgentMessageInput): AgentMessageInput {
    return appendTextToContents(request, TODO_PROMPT_SUFFIX, (text) =>
      text.includes(TODO_PROMPT_SUFFIX),
    );
  }

  recordModelActivity(event: ServerAgentStreamEvent): void {
    if (!this.todoToolsAvailable) {
      return;
    }
    if (event.type !== AgentEventType.ToolCallResponse) {
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
      const store = new TodoStore(
        sessionId,
        {
          dataDirResolver: this.todoDataDirResolver,
        },
        DEFAULT_AGENT_ID,
      );
      return await store.readTodos();
    } catch {
      // Reading persisted task-list state failed; return an empty snapshot.
      return [];
    }
  }

  async readPausedState(): Promise<boolean> {
    try {
      const sessionId = this.config.getSessionId();
      const store = new TodoStore(
        sessionId,
        {
          dataDirResolver: this.todoDataDirResolver,
        },
        DEFAULT_AGENT_ID,
      );
      return await store.readPausedState();
    } catch {
      return false;
    }
  }

  async clearPausedState(): Promise<void> {
    try {
      const sessionId = this.config.getSessionId();
      const store = new TodoStore(
        sessionId,
        {
          dataDirResolver: this.todoDataDirResolver,
        },
        DEFAULT_AGENT_ID,
      );
      await store.writePausedState(false);
    } catch {
      // Clearing paused task-list state failed; do not block the new prompt.
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
        .map((todo) => normalizeTodoForComparison(todo))
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
    if (await this.readPausedState()) {
      return { reminder: null, todos, activeTodos: [] };
    }

    const activeTodos = options?.activeTodos ?? this.getActiveTodos(todos);

    let reminder: string | null = null;
    if (todos.length === 0) {
      reminder = this.todoReminderService.getCreateListReminder([]);
    } else if (activeTodos.length > 0) {
      reminder =
        options?.escalate === true
          ? this.todoReminderService.getEscalatedActiveTodoReminder(
              activeTodos[0],
            )
          : this.todoReminderService.getUpdateActiveTodoReminder(
              activeTodos[0],
            );
    }

    return { reminder, todos, activeTodos };
  }

  appendSystemReminderToRequest(
    request: AgentMessageInput,
    reminderText: string,
  ): AgentMessageInput {
    return appendTextToContents(
      request,
      reminderText,
      (text) => text === reminderText,
    );
  }

  shouldDeferStreamEvent(event: ServerAgentStreamEvent): boolean {
    return (
      event.type === AgentEventType.Content ||
      event.type === AgentEventType.Finished ||
      event.type === AgentEventType.Citation
    );
  }

  isTodoPauseResponse(response: ToolCallResponseInfo | undefined): boolean {
    if (!response?.responseParts) {
      return false;
    }
    return response.responseParts.some((part) => {
      const name = getToolResponseName(part);
      return name !== undefined && name.toLowerCase() === 'todo_pause';
    });
  }

  /**
   * Authoritative pause signal: a pause-tool response is only treated as a
   * successful pause when the tool completed without an error or errorType.
   * Invalid input (schema/validation failure, empty/overlong reason, or a
   * reason rejected by filtering) surfaces as an error and must NOT break the
   * continuation loop.
   */
  isSuccessfulTodoPauseResponse(
    response: ToolCallResponseInfo | undefined,
  ): boolean {
    if (response === undefined || !this.isTodoPauseResponse(response)) {
      return false;
    }
    return response.error === undefined && response.errorType === undefined;
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

    if (hadThinking && !hadContent) {
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

  async applyPendingReminder(
    request: AgentMessageInput,
  ): Promise<AgentMessageInput> {
    if (this.toolCallReminderLevel === 'none') return request;

    if (await this.readPausedState()) {
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
      return request;
    }

    const reminderResult = await this.getTodoReminderForCurrentState({
      todoSnapshot: this.lastTodoSnapshot,
      escalate: this.toolCallReminderLevel === 'escalated',
    });

    if (reminderResult.reminder) {
      request = this.appendSystemReminderToRequest(
        request,
        reminderResult.reminder,
      );
      this.lastTodoSnapshot = reminderResult.todos;
    }

    this.toolCallReminderLevel = 'none';
    this.toolActivityCount = 0;
    return request;
  }
}
