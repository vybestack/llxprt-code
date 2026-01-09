/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useTodoContext } from '../contexts/TodoContext.js';
import { useToolCallContext } from '../contexts/ToolCallContext.js';
import { SemanticColors } from '../colors.js';
import { Todo as CoreTodo, Subtask } from '@vybestack/llxprt-code-core';
import { truncateEnd } from '../utils/responsive.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface Todo extends CoreTodo {
  subtasks?: Subtask[];
}

interface TodoPanelProps {
  width: number;
  collapsed?: boolean;
}

// Calculate viewport and visible items based on todos and current index
function calculateViewport(
  todos: Todo[],
  currentIndex: number,
  maxVisibleItems: number,
) {
  if (todos.length <= maxVisibleItems) {
    return {
      startIndex: 0,
      endIndex: todos.length - 1,
      hasMoreAbove: false,
      hasMoreBelow: false,
    };
  }

  let startIndex: number;
  let endIndex: number;

  if (currentIndex !== -1) {
    // Prefer to center around current task, but with -1 offset to place it higher
    const itemsBeforeCurrent = Math.floor((maxVisibleItems - 2) / 2);
    const itemsAfterCurrent = maxVisibleItems - 2 - itemsBeforeCurrent;

    startIndex = Math.max(0, currentIndex - itemsBeforeCurrent);
    endIndex = Math.min(todos.length - 1, currentIndex + itemsAfterCurrent);

    // Adjust if we're near the beginning
    if (startIndex === 0) {
      endIndex = Math.min(todos.length - 1, maxVisibleItems - 2);
    }
    // Adjust if we're near the end
    if (endIndex === todos.length - 1) {
      startIndex = Math.max(0, endIndex - (maxVisibleItems - 2));
    }
  } else {
    // No current task, show tail
    startIndex = Math.max(0, todos.length - (maxVisibleItems - 2));
    endIndex = todos.length - 1;
  }

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < todos.length - 1;

  return { startIndex, endIndex, hasMoreAbove, hasMoreBelow };
}

// Calculate max visible items based on terminal rows (25% cap)
function calculateMaxVisibleItems(rows: number): number {
  return Math.max(3, Math.floor(rows * 0.25));
}

const TodoPanelComponent: React.FC<TodoPanelProps> = ({
  width,
  collapsed = false,
}) => {
  const { todos } = useTodoContext();
  const { subscribe } = useToolCallContext();
  const { rows } = useTerminalSize();
  const [contentKey, setContentKey] = useState(0);

  // Force re-render when todos change
  useEffect(() => {
    setContentKey((prev) => prev + 1);
  }, [todos]);

  // Subscribe to tool call updates to re-render when they change
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setContentKey((prev) => prev + 1);
    });
    return unsubscribe;
  }, [subscribe]);

  const maxVisibleItems = useMemo(() => calculateMaxVisibleItems(rows), [rows]);
  const currentTodoIndex = todos.findIndex(
    (todo) => todo.status === 'in_progress',
  );
  const viewport = collapsed
    ? { startIndex: 0, endIndex: 0, hasMoreAbove: false, hasMoreBelow: false }
    : calculateViewport(todos, currentTodoIndex, maxVisibleItems);

  // Auto-hide when no todos exist - must be after all hooks to maintain consistent hook count
  if (todos.length === 0) {
    return null;
  }

  // Render a single todo item (compact, single-line)
  const renderCompactTodo = (
    todo: Todo,
    availableWidth: number,
  ): React.ReactElement => {
    let marker = '';
    let markerColor = SemanticColors.text.primary;

    if (todo.status === 'completed') {
      marker = '\u2713'; // [OK] checkmark
      markerColor = SemanticColors.status.success;
    } else if (todo.status === 'pending') {
      marker = '○';
      markerColor = SemanticColors.text.secondary;
    } else if (todo.status === 'in_progress') {
      marker = '→';
      markerColor = SemanticColors.status.warning;
    }

    // Calculate available width for content
    const contentWidth = Math.max(20, Math.floor(availableWidth * 0.9));
    const truncatedContent = truncateEnd(todo.content, contentWidth);

    return (
      <Box key={`${todo.id}-${contentKey}`} flexDirection="row" minHeight={1}>
        <Text color={markerColor} bold>
          {marker}{' '}
        </Text>
        <Box flexGrow={1}>
          <Text
            color={
              todo.status === 'in_progress'
                ? SemanticColors.status.warning
                : SemanticColors.text.primary
            }
            bold={todo.status === 'in_progress'}
          >
            {truncatedContent}
          </Text>
        </Box>
      </Box>
    );
  };

  // Render collapsed state (minimal)
  if (collapsed) {
    const summary = `${todos.length} task${todos.length !== 1 ? 's' : ''}`;
    const currentTodo = todos[currentTodoIndex];

    return (
      <Box
        flexDirection="column"
        width={width}
        borderStyle="single"
        borderColor={SemanticColors.text.accent}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        <Box flexDirection="row" minHeight={1}>
          <Text color={SemanticColors.text.primary} bold>
            {summary}
          </Text>
          {currentTodo && (
            <>
              <Text color={SemanticColors.text.secondary}> • </Text>
              <Text color={SemanticColors.status.warning} bold>
                {truncateEnd(
                  currentTodo.content,
                  Math.max(30, Math.floor(width * 0.7)),
                )}
              </Text>
            </>
          )}
          <Text color={SemanticColors.text.secondary}> • Ctrl+Q to expand</Text>
        </Box>
      </Box>
    );
  }

  // Render expanded state with carets
  const allElements: React.ReactElement[] = [];

  // Header with hint
  allElements.push(
    <Box key="header" minHeight={1} marginBottom={0}>
      <Text color={SemanticColors.text.accent} bold>
        Todo Progress
      </Text>
      <Text color={SemanticColors.text.secondary}> • Ctrl+Q to minimize</Text>
    </Box>,
  );

  // Upper caret
  if (viewport.hasMoreAbove) {
    allElements.push(
      <Box key={`upper-caret-${contentKey}`} flexDirection="row" minHeight={1}>
        <Text color={SemanticColors.text.secondary}>▲</Text>
      </Box>,
    );
  }

  // Visible todos
  for (let i = viewport.startIndex; i <= viewport.endIndex; i++) {
    const todo = todos[i];
    allElements.push(renderCompactTodo(todo, width - 2)); // -2 for padding
  }

  // Lower caret
  if (viewport.hasMoreBelow) {
    allElements.push(
      <Box key={`lower-caret-${contentKey}`} flexDirection="row" minHeight={1}>
        <Text color={SemanticColors.text.secondary}>▼</Text>
      </Box>,
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={SemanticColors.text.accent}
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      {allElements}
    </Box>
  );
};

export const TodoPanel = TodoPanelComponent;
