/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { type Todo } from '@vybestack/llxprt-code-core';

export class TodoPausePreserver {
  private preserveNextSubmission = false;

  handleSubmit(onClear: () => void): void {
    if (this.preserveNextSubmission) {
      this.preserveNextSubmission = false;
      return;
    }
    onClear();
  }

  registerTodoPause(): void {
    this.preserveNextSubmission = true;
  }
}

interface UseTodoPausePreserverOptions {
  controller: TodoPausePreserver;
  updateTodos: (todos: Todo[]) => void;
  handleFinalSubmit: (submittedValue: string) => void;
}

export const useTodoPausePreserver = ({
  controller,
  updateTodos,
  handleFinalSubmit,
}: UseTodoPausePreserverOptions) => {
  const handleUserInputSubmit = useCallback(
    (submittedValue: string) => {
      controller.handleSubmit(() => {
        updateTodos([]);
      });
      handleFinalSubmit(submittedValue);
    },
    [controller, updateTodos, handleFinalSubmit],
  );

  return {
    handleUserInputSubmit,
  };
};
