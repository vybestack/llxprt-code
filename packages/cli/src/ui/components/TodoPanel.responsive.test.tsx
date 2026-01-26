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
  type MockedFunction,
} from 'vitest';
import { TodoPanel } from './TodoPanel.js';
import { TodoContext } from '../contexts/TodoContext.js';
import { ToolCallContext } from '../contexts/ToolCallContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Todo } from '@vybestack/llxprt-code-core';

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

const testTodos: Todo[] = [
  {
    id: '1',
    content:
      'This is a very long todo item that should be truncated at different widths',
    status: 'completed',
  },
  {
    id: '2',
    content: 'Short task',
    status: 'in_progress',
  },
  {
    id: '3',
    content: 'Another pending task with moderate length content',
    status: 'pending',
  },
];

describe('TodoPanel Responsive Behavior', () => {
  let mockUseTerminalSize: MockedFunction<typeof useTerminalSize>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalSize = useTerminalSize as MockedFunction<
      typeof useTerminalSize
    >;
    mockTodoContext.todos = testTodos;
  });

  describe('NARROW width behavior (< 80 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });
    });

    it('should show only task count and status indicators for narrow width', () => {
      const { lastFrame } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={60} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      const output = lastFrame();

      // Should show status indicators but not full content
      expect(output).toMatch(/\[\*\]/); // completed marker
      expect(output).toMatch(/→/); // in_progress marker
      expect(output).toMatch(/\[ \]/); // pending marker

      // Should show task count summary
      expect(output).toMatch(/3 tasks/i);
      expect(output).toMatch(/1 completed/i);
      expect(output).toMatch(/1 in progress/i);
      expect(output).toMatch(/1 pending/i);

      // Should NOT show full task content
      expect(output).not.toContain('This is a very long todo item');
      expect(output).not.toContain('Short task');
      expect(output).not.toContain('Another pending task');
    });
  });

  describe('STANDARD width behavior (80-120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });
    });

    it('should show abbreviated task titles for standard width', () => {
      const { lastFrame } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={100} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      const output = lastFrame();

      // Should show status indicators
      expect(output).toMatch(/✔/);
      expect(output).toMatch(/→/);
      expect(output).toMatch(/○/);

      // With improved truncation (85% width), more content should be visible
      // At 100px width, the long content should now fit or be less aggressively truncated
      expect(output).toContain('Short task'); // Short enough to show fully

      // The long content should either show fully or with much more visible text
      const hasFullContent = output!.includes(
        'This is a very long todo item that should be truncated at different widths',
      );
      const hasTruncatedContent = output!.match(
        /This is a very long todo.*\.\.\./,
      );

      // Either full content is shown or it's truncated but with much more content visible
      expect(hasFullContent || hasTruncatedContent).toBe(true);

      // Should NOT show task count summary (that's only for narrow)
      expect(output).not.toMatch(/3 tasks/i);
    });
  });

  describe('WIDE width behavior (> 120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
    });

    it('should show full task details for wide width', () => {
      const { lastFrame } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={180} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      const output = lastFrame();

      // Should show status indicators
      expect(output).toMatch(/✔/);
      expect(output).toMatch(/→/);
      expect(output).toMatch(/○/);

      // Should show full task content
      expect(output).toContain(
        'This is a very long todo item that should be truncated at different widths',
      );
      expect(output).toContain('Short task');
      expect(output).toContain(
        'Another pending task with moderate length content',
      );

      // Should show full "current" indicator for in-progress tasks
      expect(output).toMatch(/Short task.*← current/);
    });
  });

  describe('Breakpoint edge cases', () => {
    it('should handle exact breakpoint boundaries correctly', () => {
      // Test exactly at NARROW threshold (80 cols)
      mockUseTerminalSize.mockReturnValue({ columns: 80, rows: 20 });

      const { lastFrame: narrowFrame } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={80} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      const narrowOutput = narrowFrame();
      // At exactly 80, should be STANDARD behavior (not NARROW)
      expect(narrowOutput).not.toMatch(/3 tasks/i);
      expect(narrowOutput).toContain('Short task');

      // Test exactly at STANDARD threshold (120 cols)
      mockUseTerminalSize.mockReturnValue({ columns: 120, rows: 20 });

      const { lastFrame: standardFrame } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={120} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      const standardOutput = standardFrame();
      // At exactly 120, should be STANDARD behavior
      expect(standardOutput).toContain('Short task');
    });
  });

  describe('Dynamic width changes', () => {
    it('should update display when width changes', () => {
      // Start narrow
      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });

      const { lastFrame, rerender } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={60} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      expect(lastFrame()).toMatch(/3 tasks/i);

      // Change to wide
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
      rerender(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={180} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      expect(lastFrame()).toContain(
        'This is a very long todo item that should be truncated at different widths',
      );
    });
  });

  describe('Content truncation behavior', () => {
    it('should use less aggressive truncation - 80-90% of available width instead of 50%', () => {
      // Test with 100px width at standard breakpoint
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });

      const testTodosForTruncation: Todo[] = [
        {
          id: '1',
          content:
            'This is a very long todo item that should use more width for better readability instead of being truncated too early',
          status: 'pending',
        },
      ];

      mockTodoContext.todos = testTodosForTruncation;

      const { lastFrame } = render(
        <TodoContext.Provider value={mockTodoContext}>
          <ToolCallContext.Provider value={mockToolCallContext}>
            <TodoPanel width={100} />
          </ToolCallContext.Provider>
        </TodoContext.Provider>,
      );

      const output = lastFrame();

      // With 100px width, the old 50% logic would give ~50px content width
      // The new 80-90% logic should give ~80-90px content width
      // This means more of the content should be visible before truncation

      // Count visible characters before truncation
      const contentMatch = output!.match(/○\s+([^.]+(?:\.\.\.)?)(?:\s|$)/);
      expect(contentMatch).toBeDefined();
      const visibleContent = contentMatch![1];

      // With better truncation (80-90%), we should see more content
      // Old logic (50%): ~25 chars visible before "..."
      // New logic (80-90%): ~40+ chars visible before "..."
      const isTruncated = visibleContent.endsWith('...');
      const visibleChars = isTruncated
        ? visibleContent.length - 3
        : visibleContent.length;

      expect(visibleChars).toBeGreaterThan(30); // Should show more content
    });

    it('should show significantly more content at wider breakpoints due to less aggressive truncation', () => {
      const longTodo: Todo[] = [
        {
          id: '1',
          content:
            'This extremely long todo item content should demonstrate the improved truncation behavior by showing much more text',
          status: 'pending',
        },
      ];

      mockTodoContext.todos = longTodo;

      // Test at different widths to verify less aggressive truncation
      const widthTests = [
        { width: 80, expectedMinChars: 25 }, // Should show more than old 50% logic
        { width: 100, expectedMinChars: 35 }, // Should show much more
        { width: 120, expectedMinChars: 45 }, // Should show even more
      ];

      widthTests.forEach(({ width, expectedMinChars }) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });

        const { lastFrame } = render(
          <TodoContext.Provider value={mockTodoContext}>
            <ToolCallContext.Provider value={mockToolCallContext}>
              <TodoPanel width={width} />
            </ToolCallContext.Provider>
          </TodoContext.Provider>,
        );

        const output = lastFrame();
        const contentMatch = output!.match(/○\s+([^.]+(?:\.\.\.)?)(?:\s|$)/);

        expect(contentMatch).toBeDefined();
        const visibleContent = contentMatch![1];
        const visibleChars = visibleContent.endsWith('...')
          ? visibleContent.length - 3
          : visibleContent.length;

        expect(visibleChars).toBeGreaterThanOrEqual(expectedMinChars);
      });
    });
  });
});
