/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Config,
  GeminiClient,
  Todo,
  ApprovalMode,
} from '@vybestack/llxprt-code-core';
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
}

/**
 * React hook for todo continuation - monitors stream completion and triggers continuation
 * prompts when active todos exist but no tool calls were made.
 * [REQ-001] Todo Continuation Detection, [REQ-002] Continuation Prompting
 */
export const useTodoContinuation = (
  geminiClient: GeminiClient,
  config: Config,
  isResponding: boolean,
  onDebugMessage: (message: string) => void,
): TodoContinuationHook => {
  const [continuationState, setContinuationState] = useState<ContinuationState>(
    {
      isActive: false,
      attemptCount: 0,
    },
  );

  // Track if a continuation is currently in progress to prevent rapid firing
  const continuationInProgressRef = useRef<boolean>(false);
  const todoPausedRef = useRef<boolean>(false);

  const todoContext = useTodoContext();
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const continuationTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Private helper methods
  const _evaluateContinuationConditions = useCallback(
    (hadToolCalls: boolean, todoPaused: boolean): ContinuationConditions => {
      const ephemeralSettings = config.getEphemeralSettings();
      const isEnabled = ephemeralSettings['todo-continuation'] === true;
      const hasActiveTodos = todoContext.todos.some(
        (todo) => todo.status === 'pending' || todo.status === 'in_progress',
      );
      const hadBlockingToolCalls =
        hadToolCalls && (todoPaused || !hasActiveTodos);

      return {
        streamCompleted: true,
        noToolCallsMade: !hadBlockingToolCalls,
        hasActiveTodos,
        continuationEnabled: isEnabled,
        notAlreadyContinuing: !continuationState.isActive,
        todoPaused,
      };
    },
    [config, todoContext.todos, continuationState.isActive],
  );

  const _shouldTriggerContinuation = useCallback(
    (conditions: ContinuationConditions): boolean => {
      // Don't trigger if AI is currently responding
      if (isResponding) {
        return false;
      }

      return (
        conditions.streamCompleted &&
        conditions.noToolCallsMade &&
        conditions.hasActiveTodos &&
        conditions.continuationEnabled &&
        conditions.notAlreadyContinuing &&
        !conditions.todoPaused
      );
    },
    [isResponding],
  );

  const _findMostRelevantActiveTodo = useCallback(
    (todos: Todo[]): Todo | null => {
      // Priority order: in_progress > pending
      const inProgressTodos = todos.filter(
        (todo) => todo.status === 'in_progress',
      );

      if (inProgressTodos.length > 0) {
        return inProgressTodos[0];
      }

      const pendingTodos = todos.filter((todo) => todo.status === 'pending');

      if (pendingTodos.length > 0) {
        return pendingTodos[0];
      }

      return null;
    },
    [],
  );

  const _generateContinuationPrompt = useCallback(
    (todo: Todo): string => {
      const isYoloMode = config.getApprovalMode() === ApprovalMode.YOLO;

      if (isYoloMode) {
        return `Continue to proceed with the active task without waiting for confirmation: "${todo.content}"`;
      }

      return `Please continue working on the following task: "${todo.content}"`;
    },
    [config],
  );

  const _triggerContinuation = useCallback(
    (activeTodo: Todo): void => {
      // Prevent multiple rapid continuations
      if (continuationInProgressRef.current) {
        return;
      }

      // Mark continuation as in progress
      continuationInProgressRef.current = true;

      // Update state to indicate continuation is active
      setContinuationState((prev) => ({
        isActive: true,
        taskDescription: activeTodo.content,
        attemptCount: prev.attemptCount + 1,
        lastPromptTime: new Date(),
      }));

      // Generate continuation prompt
      const continuationPrompt = _generateContinuationPrompt(activeTodo);

      // Send out-of-band prompt (ephemeral, not stored in history)
      // Fire and forget - don't await this
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
          // Reset state on error
          setContinuationState((prev) => ({
            isActive: false,
            attemptCount: prev.attemptCount,
            lastPromptTime: prev.lastPromptTime,
            taskDescription: prev.taskDescription,
          }));
        })
        .finally(() => {
          // Always reset the in-progress flag
          continuationInProgressRef.current = false;
        });
    },
    [geminiClient, _generateContinuationPrompt, onDebugMessage],
  );

  // Public interface methods
  const handleStreamCompleted = useCallback(
    (hadToolCalls: boolean): void => {
      if (hadToolCalls) {
        setContinuationState((prev) => ({
          ...prev,
          isActive: false,
        }));
      }

      const todoPaused = todoPausedRef.current;
      todoPausedRef.current = false;

      const conditions = _evaluateContinuationConditions(
        hadToolCalls,
        todoPaused,
      );

      if (!_shouldTriggerContinuation(conditions)) {
        return;
      }

      // Find the most relevant active todo
      const activeTodo = _findMostRelevantActiveTodo(todoContext.todos);

      if (
        !activeTodo ||
        !activeTodo.content ||
        activeTodo.content.trim() === ''
      ) {
        return;
      }

      // Prevent multiple rapid continuations
      if (continuationState.isActive || continuationInProgressRef.current) {
        return;
      }

      // Start continuation process
      _triggerContinuation(activeTodo);
    },
    [
      _evaluateContinuationConditions,
      _shouldTriggerContinuation,
      _findMostRelevantActiveTodo,
      _triggerContinuation,
      todoContext.todos,
      continuationState.isActive,
    ],
  );

  const handleTodoPause = useCallback(
    (reason: string): { type: 'pause'; reason: string; message: string } => {
      todoPausedRef.current = true;
      return {
        type: 'pause' as const,
        reason,
        message: `Task paused: ${reason}`,
      };
    },
    [],
  );
  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      clearTimeout(continuationTimeoutRef.current);
    },
    [],
  );

  return { handleStreamCompleted, continuationState, handleTodoPause };
};
