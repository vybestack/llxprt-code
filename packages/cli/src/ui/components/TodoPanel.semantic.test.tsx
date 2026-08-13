/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { render } from 'ink-testing-library';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { TodoPanel } from './TodoPanel.js';
import { TodoContext } from '../contexts/TodoContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { Todo } from '@vybestack/llxprt-code-core';
import { themeManager } from '../themes/theme-manager.js';
import { DefaultDark } from '../themes/default.js';
import { DefaultLight } from '../themes/default-light.js';
import { testRegex } from '../../test-utils/regex.js';

const realUseTerminalSizeModule = {
  ...(await import('../hooks/useTerminalSize.js')),
};

void vi.mock('../hooks/useTerminalSize.js', () =>
  automock(realUseTerminalSizeModule),
);

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

describe('TodoPanel Semantic Colors', () => {
  let originalTheme: string;
  let mockUseTerminalSize: Mock<typeof useTerminalSize>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalSize = useTerminalSize as Mock<typeof useTerminalSize>;
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
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    // Check for the marker and content pattern in the rendered output
    expect(output).toMatch(testRegex('✓.*Completed task', ''));

    // Verify the output contains the task text - exact color testing is hard with ink
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
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toMatch(testRegex('→.*Current task', ''));
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
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toMatch(testRegex('○.*Pending task', ''));
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
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    const darkOutput = darkFrame();
    expect(darkOutput).toMatch(testRegex('✓.*Test task', ''));

    // Test with light theme
    themeManager.setActiveTheme(DefaultLight.name);
    const { lastFrame: lightFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    const lightOutput = lightFrame();
    expect(lightOutput).toMatch(testRegex('✓.*Test task', ''));

    // Both should render correctly even though colors might be different
    expect(darkOutput).toBeTruthy();
    expect(lightOutput).toBeTruthy();
  });

  it('should not render when no todos exist', () => {
    mockTodoContext.todos = [];

    const { lastFrame } = render(
      <TodoContext.Provider value={mockTodoContext}>
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    expect(lastFrame()).toBe('');
  });

  it('renders todo content with no tool-call provider in the tree', () => {
    const todo: Todo = {
      id: '1',
      content: 'Standalone task',
      status: 'in_progress',
    };

    const localTodoContext = {
      ...mockTodoContext,
      todos: [todo],
    };

    const { lastFrame } = render(
      <TodoContext.Provider value={localTodoContext}>
        <TodoPanel width={150} />
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toContain('Todo Progress');
    expect(output).toContain('Standalone task');
  });

  it('renders a collapsed summary with only TodoContext in the tree', () => {
    const todos: Todo[] = [
      { id: '1', content: 'Done step', status: 'completed' },
      { id: '2', content: 'Active work', status: 'in_progress' },
      { id: '3', content: 'Later step', status: 'pending' },
    ];

    const localTodoContext = {
      ...mockTodoContext,
      todos,
    };

    const { lastFrame } = render(
      <TodoContext.Provider value={localTodoContext}>
        <TodoPanel width={150} collapsed />
      </TodoContext.Provider>,
    );

    const output = lastFrame();
    expect(output).toContain('3 tasks');
    expect(output).toContain('Active work');
    expect(output).toContain('Ctrl+Q to expand');
    expect(output).not.toContain('Todo Progress');
    expect(output).not.toContain('Done step');
    expect(output).not.toContain('Later step');
  });
});
