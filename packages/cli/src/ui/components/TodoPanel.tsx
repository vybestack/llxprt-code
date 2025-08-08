/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useTodoContext } from '../contexts/TodoContext.js';
import { useToolCallContext } from '../contexts/ToolCallContext.js';
import { SemanticColors } from '../colors.js';
import {
  Todo as CoreTodo,
  Subtask,
  TodoToolCall,
} from '@vybestack/llxprt-code-core';
import { groupToolCalls } from './todo-utils.js';

interface Todo extends CoreTodo {
  subtasks?: Subtask[];
}

interface TodoPanelProps {
  width: number;
}

const formatParameters = (parameters: Record<string, unknown>): string => {
  const paramStrings: string[] = [];
  const MAX_LENGTH = 40; // Doubled from 20 to be less aggressive

  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string') {
      let displayValue = value;

      // Special handling for file paths - show the end part
      if (
        key === 'file_path' ||
        key === 'absolute_path' ||
        value.includes('/')
      ) {
        if (value.length > MAX_LENGTH) {
          // For paths, show the last part which is more useful
          displayValue = '...' + value.slice(-(MAX_LENGTH - 3));
        }
      } else {
        // For non-paths, truncate normally but with larger limit
        displayValue =
          value.length > MAX_LENGTH
            ? value.substring(0, MAX_LENGTH - 3) + '...'
            : value;
      }

      paramStrings.push(`${key}: '${displayValue}'`);
    } else {
      const jsonStr = JSON.stringify(value);
      const displayValue =
        jsonStr.length > MAX_LENGTH
          ? jsonStr.substring(0, MAX_LENGTH - 3) + '...'
          : jsonStr;
      paramStrings.push(`${key}: ${displayValue}`);
    }
  }

  return paramStrings.join(', ');
};

const renderToolCall = (
  toolCall: TodoToolCall,
  count: number = 1,
  indent: string = '    ',
  index: number = 0,
): React.ReactElement => {
  const params = formatParameters(toolCall.parameters);
  const toolText = `${toolCall.name}(${params})`;
  const countText = count > 1 ? ` ${count}x` : '';

  return (
    <Box
      key={`${toolCall.id || `${toolCall.name}-${index}`}`}
      flexDirection="row"
      minHeight={1}
    >
      <Text color={SemanticColors.text.secondary}>
        {indent}↳ {toolText}
        {countText}
      </Text>
    </Box>
  );
};

const renderTodo = (
  todo: Todo,
  allToolCalls: TodoToolCall[],
): React.ReactElement[] => {
  const elements: React.ReactElement[] = [];

  // Todo status marker and content
  let marker = '';
  let markerColor = SemanticColors.text.primary;

  if (todo.status === 'completed') {
    marker = '✔';
    markerColor = SemanticColors.status.success;
  } else if (todo.status === 'pending') {
    marker = '○';
    markerColor = SemanticColors.text.secondary;
  } else if (todo.status === 'in_progress') {
    marker = '→';
    markerColor = SemanticColors.status.warning;
  }

  // Main todo line
  elements.push(
    <Box key={todo.id} flexDirection="row" minHeight={1}>
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
          wrap="wrap"
        >
          {todo.content}
          {todo.status === 'in_progress' && (
            <Text color={SemanticColors.status.warning}> ← current</Text>
          )}
        </Text>
      </Box>
    </Box>,
  );

  // Render subtasks and their tool calls
  if (todo.subtasks && todo.subtasks.length > 0) {
    for (const subtask of todo.subtasks) {
      elements.push(
        <Box key={`${todo.id}-subtask-${subtask.content}`}>
          <Text color={SemanticColors.text.secondary}>
            {' '}
            • {subtask.content}
          </Text>
        </Box>,
      );

      if (subtask.toolCalls && subtask.toolCalls.length > 0) {
        const grouped = groupToolCalls(subtask.toolCalls);
        grouped.forEach((group, index) => {
          elements.push(
            renderToolCall(group.toolCall, group.count, '      ', index),
          );
        });
      }
    }
  }

  // Group and render all tool calls from memory (only for in_progress tasks)
  if (allToolCalls.length > 0 && todo.status === 'in_progress') {
    const grouped = groupToolCalls(allToolCalls);
    grouped.forEach((group, index) => {
      elements.push(renderToolCall(group.toolCall, group.count, '  ', index));
    });
  }

  return elements;
};

const TodoPanelComponent: React.FC<TodoPanelProps> = ({ width }) => {
  const { todos } = useTodoContext();
  const { getExecutingToolCalls, subscribe } = useToolCallContext();
  const [, forceUpdate] = useState({});
  const [contentKey, setContentKey] = useState(0);

  // Force re-render when todos change
  useEffect(() => {
    forceUpdate({});
    setContentKey((prev) => prev + 1);
  }, [todos]);

  // Subscribe to tool call updates to re-render when they change
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      forceUpdate({});
      setContentKey((prev) => prev + 1);
    });
    return unsubscribe;
  }, [subscribe]);

  if (todos.length === 0) {
    return null; // Auto-hide when no todos exist
  }

  const allElements: React.ReactElement[] = [];

  // Add header
  allElements.push(
    <Box key="header" minHeight={1} marginBottom={1}>
      <Text color={SemanticColors.text.accent} bold>
        Todo Progress
      </Text>
    </Box>,
  );

  // Add todos
  for (const todo of todos) {
    const allToolCalls = getExecutingToolCalls(todo.id); // This now gets all tool calls
    const todoElements = renderTodo(todo, allToolCalls);
    allElements.push(...todoElements);

    // Add spacing between todos
    allElements.push(<Box key={`${todo.id}-spacer`} height={1} />);
  }

  return (
    <Box
      key={`todo-panel-${contentKey}`} // Force re-render by changing key when content changes
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={SemanticColors.text.accent}
      paddingX={1}
      paddingY={1}
    >
      {allElements}
    </Box>
  );
};

// Export without memo to ensure updates when context changes
export const TodoPanel = TodoPanelComponent;
