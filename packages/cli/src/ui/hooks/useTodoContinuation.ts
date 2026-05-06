/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Config, GeminiClient, Todo } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { useTodoContext } from '../contexts/TodoContext.js';

export interface ContinuationState {
  isActive: boolean;
  taskDescription?: string;
  attemptCount: number;
  lastPromptTime?: Date;
}

export interface ContinuationOptions {
  taskDescription: string;
  isYoloMode: boolean;
}

interface ContinuationConditions {
  streamCompleted: boolean;
  noToolCallsMade: boolean;
  hasActiveTodos: boolean;
  continuationEnabled: boolean;
  notAlreadyContinuing: boolean;
  todoPaused: boolean;
}

export interface TodoContinuationHook {
  handleStreamCompleted: (hadToolCalls: boolean) => void;
  continuationState: ContinuationState;
  handleTodoPause: (reason: string) => {
    type: 'pause';
    reason: string;
    message: string;
  };
  clearPause: () => void;
}

function evaluateConditions(
  hadToolCalls: boolean,
  todoPaused: boolean,
  config: Config,
  todos: Todo[],
  isActive: boolean,
): ContinuationConditions {
  const ephemeralSettings = config.getEphemeralSettings();
  const isEnabled = ephemeralSettings['todo-continuation'] === true;
  const hasActiveTodos = todos.some(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress',
  );
  const hadBlockingToolCalls = hadToolCalls && (todoPaused || !hasActiveTodos);

  return {
    streamCompleted: true,
    noToolCallsMade: !hadBlockingToolCalls,
    hasActiveTodos,
    continuationEnabled: isEnabled,
    notAlreadyContinuing: !isActive,
    todoPaused,
  };
}

function shouldTrigger(
  conditions: ContinuationConditions,
  isResponding: boolean,
): boolean {
  if (isResponding) {
    return false;
  }

  const baseConditionsMet =
    conditions.streamCompleted &&
    conditions.noToolCallsMade &&
    conditions.hasActiveTodos;
  const continuationReady =
    conditions.continuationEnabled && conditions.notAlreadyContinuing;
  return baseConditionsMet && continuationReady && !conditions.todoPaused;
}

function findMostRelevantTodo(todos: Todo[]): Todo | null {
  const inProgressTodos = todos.filter((todo) => todo.status === 'in_progress');

  if (inProgressTodos.length > 0) {
    return inProgressTodos[0];
  }

  const pendingTodos = todos.filter((todo) => todo.status === 'pending');

  if (pendingTodos.length > 0) {
    return pendingTodos[0];
  }

  return null;
}

function generatePrompt(todo: Todo, config: Config): string {
  const isYoloMode = config.getApprovalMode() === ApprovalMode.YOLO;

  if (isYoloMode) {
    return `Continue to proceed with the active task without waiting for confirmation: "${todo.content}"`;
  }

  return `Please continue working on the following task: "${todo.content}"`;
}

function sendContinuationPrompt(
  geminiClient: GeminiClient,
  taskDescription: string,
  continuationPrompt: string,
  onDebugMessage: (message: string) => void,
  setContinuationState: React.Dispatch<React.SetStateAction<ContinuationState>>,
  continuationInProgressRef: React.MutableRefObject<boolean>,
): void {
  if (continuationInProgressRef.current) {
    return;
  }

  continuationInProgressRef.current = true;

  setContinuationState((prev) => ({
    isActive: true,
    taskDescription,
    attemptCount: prev.attemptCount + 1,
    lastPromptTime: new Date(),
  }));

  (
    geminiClient.sendMessageStream as unknown as (
      message: string,
      options?: { ephemeral: boolean },
    ) => Promise<void>
  )(continuationPrompt, { ephemeral: true })
    .catch((error: unknown) => {
      onDebugMessage(
        `[TodoContinuation] Error sending continuation prompt: ${error instanceof Error ? error.message : String(error)}`,
      );
      setContinuationState((prev) => ({
        isActive: false,
        attemptCount: prev.attemptCount,
        lastPromptTime: prev.lastPromptTime,
        taskDescription: prev.taskDescription,
      }));
    })
    .finally(() => {
      continuationInProgressRef.current = false;
    });
}

function processContinuation(
  hadToolCalls: boolean,
  todoContext: { todos: Todo[]; paused: boolean },
  config: Config,
  isResponding: boolean,
  continuationState: ContinuationState,
  continuationInProgressRef: React.MutableRefObject<boolean>,
  geminiClient: GeminiClient,
  onDebugMessage: (message: string) => void,
  setContinuationState: React.Dispatch<React.SetStateAction<ContinuationState>>,
): void {
  if (hadToolCalls) {
    setContinuationState((prev) => ({ ...prev, isActive: false }));
  }

  const conditions = evaluateConditions(
    hadToolCalls,
    todoContext.paused,
    config,
    todoContext.todos,
    continuationState.isActive,
  );

  if (!shouldTrigger(conditions, isResponding)) {
    return;
  }

  const activeTodo = findMostRelevantTodo(todoContext.todos);

  if (!activeTodo?.content || activeTodo.content.trim() === '') {
    return;
  }

  if (continuationState.isActive || continuationInProgressRef.current) {
    return;
  }

  const continuationPrompt = generatePrompt(activeTodo, config);
  sendContinuationPrompt(
    geminiClient,
    activeTodo.content,
    continuationPrompt,
    onDebugMessage,
    setContinuationState,
    continuationInProgressRef,
  );
}

/**
 * React hook for task continuation - monitors stream completion and triggers continuation
 * prompts when active tasks exist but no tool calls were made.
 * [REQ-001] Task Continuation Detection, [REQ-002] Continuation Prompting
 */
export const useTodoContinuation = (
  geminiClient: GeminiClient,
  config: Config,
  isResponding: boolean,
  onDebugMessage: (message: string) => void,
): TodoContinuationHook => {
  const [continuationState, setContinuationState] = useState<ContinuationState>(
    { isActive: false, attemptCount: 0 },
  );

  const continuationInProgressRef = useRef<boolean>(false);
  const todoContext = useTodoContext();
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const continuationTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleStreamCompleted = useCallback(
    (hadToolCalls: boolean): void => {
      processContinuation(
        hadToolCalls,
        todoContext,
        config,
        isResponding,
        continuationState,
        continuationInProgressRef,
        geminiClient,
        onDebugMessage,
        setContinuationState,
      );
    },
    [
      config,
      todoContext,
      continuationState,
      isResponding,
      geminiClient,
      onDebugMessage,
    ],
  );

  const handleTodoPause = useCallback(
    (reason: string): { type: 'pause'; reason: string; message: string } => {
      todoContext.setPaused(true);
      return {
        type: 'pause' as const,
        reason,
        message: `Task paused: ${reason}`,
      };
    },
    [todoContext],
  );

  const clearPause = useCallback(() => {
    todoContext.setPaused(false);
  }, [todoContext]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      clearTimeout(continuationTimeoutRef.current);
    },
    [],
  );

  return {
    handleStreamCompleted,
    continuationState,
    handleTodoPause,
    clearPause,
  };
};
