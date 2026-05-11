/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useTodoContext } from '../contexts/TodoContext.js';
import { useToolCallContext } from '../contexts/ToolCallContext.js';
import { SemanticColors } from '../colors.js';
import type { Todo as CoreTodo, Subtask } from '@vybestack/llxprt-code-core';
import { truncateEnd } from '../utils/responsive.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface Todo extends CoreTodo {
  subtasks?: Subtask[];
}

interface TodoPanelProps {
  width: number;
  collapsed?: boolean;
}

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
    const itemsBeforeCurrent = Math.floor((maxVisibleItems - 2) / 2);
    const itemsAfterCurrent = maxVisibleItems - 2 - itemsBeforeCurrent;

    startIndex = Math.max(0, currentIndex - itemsBeforeCurrent);
    endIndex = Math.min(todos.length - 1, currentIndex + itemsAfterCurrent);

    if (startIndex === 0) {
      endIndex = Math.min(todos.length - 1, maxVisibleItems - 2);
    }
    if (endIndex === todos.length - 1) {
      startIndex = Math.max(0, endIndex - (maxVisibleItems - 2));
    }
  } else {
    startIndex = Math.max(0, todos.length - (maxVisibleItems - 2));
    endIndex = todos.length - 1;
  }

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < todos.length - 1;

  return { startIndex, endIndex, hasMoreAbove, hasMoreBelow };
}

function calculateMaxVisibleItems(rows: number): number {
  return Math.max(3, Math.floor(rows * 0.25));
}

interface CompactTodoProps {
  todo: Todo;
  availableWidth: number;
  contentKey: number;
}

const CompactTodo: React.FC<CompactTodoProps> = ({
  todo,
  availableWidth,
  contentKey,
}) => {
  let marker = '';
  let markerColor = SemanticColors.text.primary;

  switch (todo.status) {
    case 'completed':
      marker = '\u2713';
      markerColor = SemanticColors.status.success;
      break;
    case 'pending':
      marker = '○';
      markerColor = SemanticColors.text.secondary;
      break;
    case 'in_progress':
      marker = '→';
      markerColor = SemanticColors.status.warning;
      break;
    default:
      break;
  }

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

interface CollapsedTodoPanelProps {
  todos: Todo[];
  width: number;
  currentTodoIndex: number;
}

const CollapsedTodoPanel: React.FC<CollapsedTodoPanelProps> = ({
  todos,
  width,
  currentTodoIndex,
}) => {
  const summary = `${todos.length} task${todos.length !== 1 ? 's' : ''}`;
  const currentTodo =
    currentTodoIndex === -1 ? undefined : todos[currentTodoIndex];

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
};

interface ExpandedTodoPanelProps {
  todos: Todo[];
  width: number;
  viewport: {
    startIndex: number;
    endIndex: number;
    hasMoreAbove: boolean;
    hasMoreBelow: boolean;
  };
  contentKey: number;
}

const ExpandedTodoPanel: React.FC<ExpandedTodoPanelProps> = ({
  todos,
  width,
  viewport,
  contentKey,
}) => {
  const elements: React.ReactElement[] = [
    <Box key="header" minHeight={1} marginBottom={0}>
      <Text color={SemanticColors.text.accent} bold>
        Todo Progress
      </Text>
      <Text color={SemanticColors.text.secondary}> • Ctrl+Q to minimize</Text>
    </Box>,
  ];

  if (viewport.hasMoreAbove) {
    elements.push(
      <Box key={`upper-caret-${contentKey}`} flexDirection="row" minHeight={1}>
        <Text color={SemanticColors.text.secondary}>▲</Text>
      </Box>,
    );
  }

  for (let i = viewport.startIndex; i <= viewport.endIndex; i++) {
    const todo = todos[i];
    elements.push(
      <CompactTodo
        key={`${todo.id}-compact`}
        todo={todo}
        availableWidth={width - 2}
        contentKey={contentKey}
      />,
    );
  }

  if (viewport.hasMoreBelow) {
    elements.push(
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
      {elements}
    </Box>
  );
};

const TodoPanelComponent: React.FC<TodoPanelProps> = ({
  width,
  collapsed = false,
}) => {
  const { todos } = useTodoContext();
  const { subscribe } = useToolCallContext();
  const { rows } = useTerminalSize();
  const [contentKey, setContentKey] = useState(0);

  useEffect(() => {
    setContentKey((prev) => prev + 1);
  }, [todos]);

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

  if (todos.length === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <CollapsedTodoPanel
        todos={todos}
        width={width}
        currentTodoIndex={currentTodoIndex}
      />
    );
  }

  return (
    <ExpandedTodoPanel
      todos={todos}
      width={width}
      viewport={viewport}
      contentKey={contentKey}
    />
  );
};

export const TodoPanel = TodoPanelComponent;
