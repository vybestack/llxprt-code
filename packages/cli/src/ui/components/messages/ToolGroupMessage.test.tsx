/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { ToolGroupMessage } from './ToolGroupMessage.js';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import {
  Config,
  ToolCallConfirmationDetails,
  Todo,
} from '@vybestack/llxprt-code-core';
import { TodoContext } from '../../contexts/TodoContext.js';
import { ToolCallContext } from '../../contexts/ToolCallContext.js';
import { Colors } from '../../colors.js';

// Mock child components to isolate ToolGroupMessage behavior
const mockToolMessage = vi.fn();

vi.mock('./ToolMessage.js', () => ({
  ToolMessage: function MockToolMessage({
    callId,
    name,
    description,
    status,
    emphasis,
    resultDisplay,
  }: {
    callId: string;
    name: string;
    description: string;
    status: ToolCallStatus;
    emphasis: string;
    resultDisplay?: string;
  }) {
    mockToolMessage({
      callId,
      name,
      description,
      status,
      emphasis,
      resultDisplay,
    });
    const statusSymbol = {
      [ToolCallStatus.Success]: '[OK]',
      [ToolCallStatus.Pending]: 'o',
      [ToolCallStatus.Executing]: '⊷',
      [ToolCallStatus.Confirming]: '?',
      [ToolCallStatus.Canceled]: '-',
      [ToolCallStatus.Error]: 'x',
    }[status];
    return (
      <Text color={Colors.Foreground}>
        MockTool[{callId}]: {statusSymbol} {name} - {description} ({emphasis})
      </Text>
    );
  },
}));

vi.mock('./ToolConfirmationMessage.js', () => ({
  ToolConfirmationMessage: function MockToolConfirmationMessage({
    confirmationDetails,
  }: {
    confirmationDetails: ToolCallConfirmationDetails;
  }) {
    const displayText =
      confirmationDetails?.type === 'info'
        ? (confirmationDetails as { prompt: string }).prompt
        : confirmationDetails?.title || 'confirm';
    return (
      <Text color={Colors.Foreground}>MockConfirmation: {displayText}</Text>
    );
  },
}));

describe('<ToolGroupMessage />', () => {
  const mockConfig: Config = {} as Config;

  const createToolCall = (
    overrides: Partial<IndividualToolCallDisplay> = {},
  ): IndividualToolCallDisplay => ({
    callId: 'tool-123',
    name: 'test-tool',
    description: 'A tool for testing',
    resultDisplay: 'Test result',
    status: ToolCallStatus.Success,
    confirmationDetails: undefined,
    renderOutputAsMarkdown: false,
    ...overrides,
  });

  const baseProps = {
    groupId: 1,
    terminalWidth: 80,
    config: mockConfig,
    isFocused: true,
    agentId: 'helper-agent',
  };

  const defaultTodo: Todo = {
    id: 'todo-1',
    content: 'Implement role-based access control',
    status: 'in_progress',
    subtasks: [
      {
        id: 'sub-1',
        content: 'Define role enum',
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            parameters: { path: 'src/app.ts' },
            timestamp: new Date('2025-01-01T00:00:00Z'),
          },
        ],
      },
    ],
  };

  const renderWithContexts = (
    component: React.ReactElement,
    {
      todos = [],
      showTodoPanel = true,
    }: { todos?: Todo[]; showTodoPanel?: boolean } = {},
  ) => {
    const todoContextValue = {
      todos,
      updateTodos: vi.fn(),
      refreshTodos: vi.fn(),
    };
    const toolCallContextValue = {
      getExecutingToolCalls: () => [],
      subscribe: () => () => {},
    };

    return render(
      <TodoContext.Provider value={todoContextValue}>
        <ToolCallContext.Provider value={toolCallContextValue}>
          {React.cloneElement(
            component as React.ReactElement<{ showTodoPanel?: boolean }>,
            { showTodoPanel },
          )}
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );
  };

  describe('Golden Snapshots', () => {
    it('renders single successful tool call', () => {
      const toolCalls = [createToolCall()];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders multiple tool calls with different statuses', () => {
      const toolCalls = [
        createToolCall({
          callId: 'tool-1',
          name: 'successful-tool',
          description: 'This tool succeeded',
          status: ToolCallStatus.Success,
        }),
        createToolCall({
          callId: 'tool-2',
          name: 'pending-tool',
          description: 'This tool is pending',
          status: ToolCallStatus.Pending,
        }),
        createToolCall({
          callId: 'tool-3',
          name: 'error-tool',
          description: 'This tool failed',
          status: ToolCallStatus.Error,
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders tool call awaiting confirmation', () => {
      const toolCalls = [
        createToolCall({
          callId: 'tool-confirm',
          name: 'confirmation-tool',
          description: 'This tool needs confirmation',
          status: ToolCallStatus.Confirming,
          confirmationDetails: {
            type: 'info',
            title: 'Confirm Tool Execution',
            prompt: 'Are you sure you want to proceed?',
            onConfirm: vi.fn(),
          },
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders shell command with yellow border', () => {
      const toolCalls = [
        createToolCall({
          callId: 'shell-1',
          name: 'run_shell_command',
          description: 'Execute shell command',
          status: ToolCallStatus.Success,
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders mixed tool calls including shell command', () => {
      const toolCalls = [
        createToolCall({
          callId: 'tool-1',
          name: 'read_file',
          description: 'Read a file',
          status: ToolCallStatus.Success,
        }),
        createToolCall({
          callId: 'tool-2',
          name: 'run_shell_command',
          description: 'Run command',
          status: ToolCallStatus.Executing,
        }),
        createToolCall({
          callId: 'tool-3',
          name: 'write_file',
          description: 'Write to file',
          status: ToolCallStatus.Pending,
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders with limited terminal height', () => {
      const toolCalls = [
        createToolCall({
          callId: 'tool-1',
          name: 'tool-with-result',
          description: 'Tool with output',
          resultDisplay:
            'This is a long result that might need height constraints',
        }),
        createToolCall({
          callId: 'tool-2',
          name: 'another-tool',
          description: 'Another tool',
          resultDisplay: 'More output here',
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage
          {...baseProps}
          toolCalls={toolCalls}
          availableTerminalHeight={10}
        />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders when not focused', () => {
      const toolCalls = [createToolCall()];
      const { lastFrame } = render(
        <ToolGroupMessage
          {...baseProps}
          toolCalls={toolCalls}
          isFocused={false}
        />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders with narrow terminal width', () => {
      const toolCalls = [
        createToolCall({
          name: 'very-long-tool-name-that-might-wrap',
          description:
            'This is a very long description that might cause wrapping issues',
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage
          {...baseProps}
          toolCalls={toolCalls}
          terminalWidth={40}
        />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders empty tool calls array', () => {
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={[]} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });
  });

  describe('Border Color Logic', () => {
    it('uses yellow border when tools are pending', () => {
      const toolCalls = [createToolCall({ status: ToolCallStatus.Pending })];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      // The snapshot will capture the visual appearance including border color
      expect(lastFrame()).toMatchSnapshot();
    });

    it('uses yellow border for shell commands even when successful', () => {
      const toolCalls = [
        createToolCall({
          name: 'run_shell_command',
          status: ToolCallStatus.Success,
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });

    it('uses gray border when all tools are successful and no shell commands', () => {
      const toolCalls = [
        createToolCall({ status: ToolCallStatus.Success }),
        createToolCall({
          callId: 'tool-2',
          name: 'another-tool',
          status: ToolCallStatus.Success,
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });
  });

  describe('Height Calculation', () => {
    it('calculates available height correctly with multiple tools with results', () => {
      const toolCalls = [
        createToolCall({
          callId: 'tool-1',
          resultDisplay: 'Result 1',
        }),
        createToolCall({
          callId: 'tool-2',
          resultDisplay: 'Result 2',
        }),
        createToolCall({
          callId: 'tool-3',
          resultDisplay: '', // No result
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage
          {...baseProps}
          toolCalls={toolCalls}
          availableTerminalHeight={20}
        />,
      );
      expect(lastFrame()).toMatchSnapshot();
    });
  });

  describe('Confirmation Handling', () => {
    it('shows confirmation dialog for first confirming tool only', () => {
      const toolCalls = [
        createToolCall({
          callId: 'tool-1',
          name: 'first-confirm',
          status: ToolCallStatus.Confirming,
          confirmationDetails: {
            type: 'info',
            title: 'Confirm First Tool',
            prompt: 'Confirm first tool',
            onConfirm: vi.fn(),
          },
        }),
        createToolCall({
          callId: 'tool-2',
          name: 'second-confirm',
          status: ToolCallStatus.Confirming,
          confirmationDetails: {
            type: 'info',
            title: 'Confirm Second Tool',
            prompt: 'Confirm second tool',
            onConfirm: vi.fn(),
          },
        }),
      ];
      const { lastFrame } = render(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
      );
      // Should only show confirmation for the first tool
      expect(lastFrame()).toMatchSnapshot();
    });
  });

  describe('Todo panel toggle behavior', () => {
    afterEach(() => {
      mockToolMessage.mockClear();
    });

    it('minimizes todo tool output when panel is visible', () => {
      const toolCalls = [
        createToolCall({
          callId: 'todo-read',
          name: 'TodoRead',
          description: 'Read todos',
        }),
        createToolCall({
          callId: 'todo-write',
          name: 'TodoWrite',
          description: 'Write todos',
          resultDisplay: '',
        }),
      ];

      renderWithContexts(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
        { todos: [defaultTodo], showTodoPanel: true },
      );

      const todoReadCall = mockToolMessage.mock.calls.find(
        ([props]) => props?.name === 'TodoRead',
      )?.[0];
      const todoWriteCall = mockToolMessage.mock.calls.find(
        ([props]) => props?.name === 'TodoWrite',
      )?.[0];
      expect(todoReadCall?.resultDisplay).toBe('Todo list read (1 task).');
      expect(todoWriteCall?.resultDisplay).toBe(
        '✦ Todo list updated (1 task).',
      );
    });

    it('restores textual todo output when panel is disabled', () => {
      const toolCalls = [
        createToolCall({
          callId: 'todo-read',
          name: 'TodoRead',
          description: 'Read todos',
        }),
        createToolCall({
          callId: 'todo-write',
          name: 'TodoWrite',
          description: 'Write todos',
          resultDisplay: '',
        }),
      ];

      renderWithContexts(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
        { todos: [defaultTodo], showTodoPanel: false },
      );

      const todoReadCall = mockToolMessage.mock.calls.find(
        ([props]) => props?.name === 'TodoRead',
      )?.[0];
      expect(todoReadCall).toBeDefined();

      const todoWriteCall = mockToolMessage.mock.calls.find(
        ([props]) => props?.name === 'TodoWrite',
      )?.[0];
      expect(todoWriteCall?.resultDisplay).toContain('Todo Progress');
      expect(todoWriteCall?.resultDisplay).toContain(
        'Implement role-based access control',
      );
      expect(todoWriteCall?.resultDisplay).toContain('Define role enum');
    });

    it('derives task counts even when todo context is empty', () => {
      const toolCalls = [
        createToolCall({
          callId: 'todo-read',
          name: 'TodoRead',
          description: 'Read todos',
          resultDisplay: '## Todo Progress\n\n5 tasks: ...',
        }),
        createToolCall({
          callId: 'todo-write',
          name: 'TodoWrite',
          description: 'Update todo list with 5 items',
        }),
      ];

      renderWithContexts(
        <ToolGroupMessage {...baseProps} toolCalls={toolCalls} />,
        { todos: [], showTodoPanel: true },
      );

      const todoReadCall = mockToolMessage.mock.calls.find(
        ([props]) => props?.name === 'TodoRead',
      )?.[0];
      const todoWriteCall = mockToolMessage.mock.calls.find(
        ([props]) => props?.name === 'TodoWrite',
      )?.[0];

      expect(todoReadCall?.resultDisplay).toBe('Todo list read (5 tasks).');
      expect(todoWriteCall?.resultDisplay).toBe(
        '✦ Todo list updated (5 tasks).',
      );
    });
  });
});
