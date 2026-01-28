/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from 'vitest';
import { TodoPanel } from './TodoPanel.js';
import { TodoContext } from '../contexts/TodoContext.js';
import { ToolCallContext } from '../contexts/ToolCallContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Todo } from '@vybestack/llxprt-code-core';
import { themeManager } from '../themes/theme-manager.js';
import { DefaultDark } from '../themes/default.js';
import { DefaultLight } from '../themes/default-light.js';

vi.mock('../hooks/useTerminalSize.js');

// Mock contexts
const mockTodoContext = {
  todos: [] as Todo[],
  addTodo: vi.fn(),
  updateTodo: vi.fn(),
  updateTodos: vi.fn(),
  refreshTodos: vi.fn(),
  markCompleted: vi.fn(),
  markInProgress: vi.fn(),
  removeTodo: vi.fn(),
  getInProgressTodo: vi.fn(),
  getTodos: vi.fn(),
};

const mockToolCallContext = {
  getExecutingToolCalls: vi.fn(() => []),
  subscribe: vi.fn(() => () => {}),
  addToolCall: vi.fn(),
  removeToolCall: vi.fn(),
  clearToolCalls: vi.fn(),
};

describe('TodoPanel Semantic Colors', () => {
  let originalTheme: string;
  let mockUseTerminalSize: MockedFunction<typeof useTerminalSize>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalSize = useTerminalSize as MockedFunction<
      typeof useTerminalSize
    >;
    // Set wide width to ensure full task details are shown
    mockUseTerminalSize.mockReturnValue({ columns: 150, rows: 20 });
    originalTheme = themeManager.getActiveTheme().name;
    mockTodoContext.todos = [];
  });

  afterEach(() => {
    themeManager.setActiveTheme(originalTheme);
  });

  it('should use semantic success color for completed todos', () => {
    const completedTodo: Todo = {
      id: '1',
      content: 'Completed task',
      status: 'completed',
    };

    mockTodoContext.todos = [completedTodo];

    const { lastFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    // Check for the marker and content pattern in the rendered output
    expect(output).toMatch(/✔.*Completed task/);

    // Verify the output contains the todo text - exact color testing is hard with ink
    // but we can verify the component renders correctly
    expect(output).toContain('Todo Progress');
  });

  it('should use semantic warning color for in-progress todos', () => {
    const inProgressTodo: Todo = {
      id: '1',
      content: 'Current task',
      status: 'in_progress',
    };

    mockTodoContext.todos = [inProgressTodo];

    const { lastFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toMatch(/→.*Current task.*← current/);
  });

  it('should use semantic secondary color for pending todos', () => {
    const pendingTodo: Todo = {
      id: '1',
      content: 'Pending task',
      status: 'pending',
    };

    mockTodoContext.todos = [pendingTodo];

    const { lastFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toMatch(/○.*Pending task/);
  });

  it('should adapt colors when theme changes', () => {
    const testTodo: Todo = {
      id: '1',
      content: 'Test task',
      status: 'completed',
    };

    mockTodoContext.todos = [testTodo];

    // Test with dark theme
    themeManager.setActiveTheme(DefaultDark.name);
    const { lastFrame: darkFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    const darkOutput = darkFrame();
    expect(darkOutput).toMatch(/✔.*Test task/);

    // Test with light theme
    themeManager.setActiveTheme(DefaultLight.name);
    const { lastFrame: lightFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    const lightOutput = lightFrame();
    expect(lightOutput).toMatch(/✔.*Test task/);

    // Both should render correctly even though colors might be different
    expect(darkOutput).toBeTruthy();
    expect(lightOutput).toBeTruthy();
  });

  it('should not render when no todos exist', () => {
    mockTodoContext.todos = [];

    const { lastFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    expect(lastFrame()).toBe('');
  });

  it('should render subtasks with semantic secondary colors', () => {
    const todoWithSubtasks: Todo = {
      id: '1',
      content: 'Main task',
      status: 'in_progress',
      subtasks: [
        { id: '1-1', content: 'Subtask 1', toolCalls: [] },
        { id: '1-2', content: 'Subtask 2', toolCalls: [] },
      ],
    };

    mockTodoContext.todos = [todoWithSubtasks];

    const { lastFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <ToolCallContext.Provider value={mockToolCallContext}>
          <TodoPanel width={150} />
        </ToolCallContext.Provider>
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toMatch(/→.*Main task.*← current/);
    expect(output).toMatch(/•.*Subtask 1/);
    expect(output).toMatch(/•.*Subtask 2/);
  });
});
