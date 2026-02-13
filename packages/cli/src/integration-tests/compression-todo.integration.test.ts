/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P24
 * @requirement REQ-HD-011.5, REQ-HD-012.3
 *
 * Compression + Todo Integration Test
 *
 * This test validates that compression correctly wires activeTodos into the
 * compression context, and that the continuation directive references the
 * current task after compression.
 *
 * Test approach:
 * - Uses TodoStore directly (no full runtime required)
 * - Validates the activeTodosProvider callback pattern
 * - Tests continuation directive building
 * - Simulates ./tmp/ file operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  TodoStore,
  Todo,
  buildContinuationDirective,
} from '@vybestack/llxprt-code-core';

describe('Compression Todo Integration (Issues #1387, #1388)', () => {
  let tempDir: string;
  let todoStore: TodoStore;
  let sessionId: string;
  let tmpDir: string;
  let originalHome: string | undefined;

  const createTodo = (
    id: string,
    content: string,
    status: 'pending' | 'in_progress' | 'completed' = 'pending',
  ): Todo => ({
    id,
    content,
    status,
  });

  const getActiveTodos = (todos: Todo[]): Todo[] => {
    const inProgress = todos.filter((todo) => todo.status === 'in_progress');
    const pending = todos.filter((todo) => todo.status === 'pending');
    return [...inProgress, ...pending];
  };

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-compression-test-'),
    );
    process.env.HOME = tempDir;

    // Create local ./tmp directory (not /tmp)
    tmpDir = path.join(tempDir, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });

    sessionId = 'compression-todo-test-session';
    todoStore = new TodoStore(sessionId);
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('ActiveTodos Compression Context', () => {
    it('@requirement REQ-HD-011.5 should include active todos in compression context', async () => {
      // Given: A todo list with multiple active tasks
      const todos = [
        createTodo('1', 'Analyze project structure', 'in_progress'),
        createTodo('2', 'Create temporary test files in ./tmp/', 'pending'),
        createTodo('3', 'Verify file contents with read_file', 'pending'),
        createTodo('4', 'List directory contents', 'pending'),
        createTodo('5', 'Clean up temporary files', 'completed'), // Completed, should not appear
      ];

      await todoStore.writeTodos(todos);

      // Verify todos are stored
      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(5);

      // Verify active todos are filterable (same logic as client.ts)
      const activeTodos = storedTodos.filter(
        (todo) => todo.status === 'in_progress' || todo.status === 'pending',
      );
      expect(activeTodos).toHaveLength(4);

      // Verify in_progress todos are prioritized
      const inProgressTodos = activeTodos.filter(
        (todo) => todo.status === 'in_progress',
      );
      expect(inProgressTodos).toHaveLength(1);
      expect(inProgressTodos[0].content).toBe('Analyze project structure');

      // Format active todos for compression context (matches client.ts implementation)
      const formattedActiveTodos = activeTodos
        .map((t) => `- [${t.status}] ${t.content}`)
        .join('\n');

      // Verify formatted todos include expected content
      expect(formattedActiveTodos).toContain(
        '- [in_progress] Analyze project structure',
      );
      expect(formattedActiveTodos).toContain(
        '- [pending] Create temporary test files in ./tmp/',
      );
      expect(formattedActiveTodos).toContain(
        '- [pending] Verify file contents with read_file',
      );
      expect(formattedActiveTodos).toContain(
        '- [pending] List directory contents',
      );
      expect(formattedActiveTodos).not.toContain('completed'); // Completed todos should not be active
    });

    it('@requirement REQ-HD-012.3 should format active todos for compression injection', async () => {
      // Given: Various todo states
      const mixedTodos = [
        createTodo('1', 'First in-progress task', 'in_progress'),
        createTodo('2', 'Second in-progress task', 'in_progress'),
        createTodo('3', 'Pending task A', 'pending'),
        createTodo('4', 'Pending task B', 'pending'),
        createTodo('5', 'Completed task', 'completed'),
      ];

      await todoStore.writeTodos(mixedTodos);

      // Simulate the compression context formatting from client.ts
      const storedTodos = await todoStore.readTodos();
      const active = getActiveTodos(storedTodos);

      // Format as expected by compression strategies
      const formatted = active
        .map((t) => `- [${t.status}] ${t.content}`)
        .join('\n');

      // In-progress todos should come first
      const lines = formatted.split('\n');
      expect(lines[0]).toBe('- [in_progress] First in-progress task');
      expect(lines[1]).toBe('- [in_progress] Second in-progress task');
      expect(lines[2]).toBe('- [pending] Pending task A');
      expect(lines[3]).toBe('- [pending] Pending task B');

      // Should not include completed
      expect(formatted).not.toContain('Completed task');
    });

    it('@requirement REQ-HD-012.3 should handle empty todo list gracefully', async () => {
      // Given: Empty todo list
      await todoStore.writeTodos([]);

      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(0);

      // When: Getting active todos
      const active = getActiveTodos(storedTodos);
      expect(active).toHaveLength(0);

      // Then: Provider should return undefined (no active todos)
      const provider = async (): Promise<string | undefined> => {
        const todos = await todoStore.readTodos();
        const active = getActiveTodos(todos);
        if (active.length === 0) return undefined;
        return active.map((t) => `- [${t.status}] ${t.content}`).join('\n');
      };

      const result = await provider();
      expect(result).toBeUndefined();
    });

    it('@requirement REQ-HD-011.5 should only include in_progress and pending todos', async () => {
      // Given: All status types
      const todosWithAllStatuses = [
        createTodo('1', 'In progress task', 'in_progress'),
        createTodo('2', 'Pending task', 'pending'),
        createTodo('3', 'Completed task', 'completed'),
        createTodo('4', 'Another completed', 'completed'),
        createTodo('5', 'Another pending', 'pending'),
      ];

      await todoStore.writeTodos(todosWithAllStatuses);

      const storedTodos = await todoStore.readTodos();

      // Filter like client.ts does
      const active = getActiveTodos(storedTodos);

      // Should only have 3 active (1 in_progress + 2 pending)
      expect(active).toHaveLength(3);
      expect(active.some((t) => t.content === 'In progress task')).toBe(true);
      expect(active.some((t) => t.content === 'Pending task')).toBe(true);
      expect(active.some((t) => t.content === 'Another pending')).toBe(true);
      expect(active.some((t) => t.status === 'completed')).toBe(false);
    });
  });

  describe('Continuation Directive', () => {
    it('@requirement REQ-HD-012.3 should build context-aware continuation directive with todos', () => {
      // Given: Formatted active todos
      const activeTodos = `- [in_progress] Implement authentication middleware
- [pending] Write integration tests
- [pending] Update documentation`;

      // When: Building continuation directive
      const directive = buildContinuationDirective(activeTodos);

      // Then: Directive should reference first task
      expect(directive).toBe(
        'Understood. Continue with current task: "Implement authentication middleware". Use todo_read for full context.',
      );
    });

    it('@requirement REQ-HD-012.3 should build simple directive when no todos', () => {
      // Given/When: Building directive without todos
      const directiveWithout = buildContinuationDirective();
      const directiveEmpty = buildContinuationDirective('');
      const directiveWhitespace = buildContinuationDirective('   \n  ');

      // Then: Should be simple continue statement
      expect(directiveWithout).toBe(
        'Understood. Continuing with the current task.',
      );
      expect(directiveEmpty).toBe(
        'Understood. Continuing with the current task.',
      );
      expect(directiveWhitespace).toBe(
        'Understood. Continuing with the current task.',
      );
    });

    it('@requirement REQ-HD-012.3 should extract first task correctly from single todo', () => {
      const activeTodos = '- [pending] Fix the critical auth bug';

      const directive = buildContinuationDirective(activeTodos);
      expect(directive).toBe(
        'Understood. Continue with current task: "Fix the critical auth bug". Use todo_read for full context.',
      );
    });
  });

  describe('End-to-End Integration', () => {
    it('@requirement REQ-HD-011.5, REQ-HD-012.3 should wire todos through compression pipeline', async () => {
      // Given: A realistic multi-task scenario
      const projectTasks = [
        createTodo('1', 'Read existing project files', 'in_progress'),
        createTodo('2', 'Analyze code structure', 'pending'),
        createTodo(
          '3',
          'Write analysis results to ./tmp/analysis.md',
          'pending',
        ),
        createTodo('4', 'Create summary report', 'pending'),
      ];

      await todoStore.writeTodos(projectTasks);

      // Simulate the full pipeline from client.ts -> geminiChat.ts -> compression

      // Step 1: Client creates the provider callback
      const activeTodosProvider = async (): Promise<string | undefined> => {
        const todos = await todoStore.readTodos();
        const inProgress = todos.filter(
          (todo) => todo.status === 'in_progress',
        );
        const pending = todos.filter((todo) => todo.status === 'pending');
        const active = [...inProgress, ...pending];
        if (active.length === 0) return undefined;
        return active.map((t) => `- [${t.status}] ${t.content}`).join('\n');
      };

      // Step 2: Provider returns formatted todos
      const formattedTodos = await activeTodosProvider();
      expect(formattedTodos).toBeDefined();
      expect(formattedTodos).toContain('Read existing project files');
      expect(formattedTodos).toContain('Analyze code structure');
      expect(formattedTodos).toContain(
        'Write analysis results to ./tmp/analysis.md',
      );

      // Step 3: Compression context includes activeTodos
      const compressionContext = {
        history: [], // Would be actual history in real scenario
        activeTodos: formattedTodos,
      };

      expect(compressionContext.activeTodos).toBeDefined();

      // Step 4: Strategy builds continuation directive
      const directive = buildContinuationDirective(
        compressionContext.activeTodos,
      );

      // Step 5: Verify directive references the current task
      expect(directive).toContain('Read existing project files');
      expect(directive).toContain('todo_read');

      // Simulate writing to ./tmp/ as specified in todos
      const analysisContent = `# Analysis Report

Current Task: Read existing project files
Active Todos:
${formattedTodos}

Status: In Progress
`;

      await fs.writeFile(
        path.join(tmpDir, 'analysis.md'),
        analysisContent,
        'utf8',
      );

      // Verify file was written to local ./tmp (not /tmp)
      const writtenContent = await fs.readFile(
        path.join(tmpDir, 'analysis.md'),
        'utf8',
      );
      expect(writtenContent).toContain('Read existing project files');
      expect(writtenContent).toContain('Analyze code structure');

      // Verify the tmp directory is scoped under this test's temp root
      expect(tmpDir.startsWith(tempDir)).toBe(true);
      expect(tmpDir).toContain(`${path.sep}tmp`);
    });

    it('@requirement REQ-HD-011.5 should handle todo updates during session', async () => {
      // Given: Initial todos
      const initialTodos = [
        createTodo('1', 'First task', 'in_progress'),
        createTodo('2', 'Second task', 'pending'),
      ];

      await todoStore.writeTodos(initialTodos);

      // When: First check
      let storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(2);

      // Simulate task progression
      const updatedTodos = [
        createTodo('1', 'First task', 'completed'),
        createTodo('2', 'Second task', 'in_progress'),
        createTodo('3', 'Third task', 'pending'),
      ];

      await todoStore.writeTodos(updatedTodos);

      // Then: Updated state
      storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(3);

      const inProgress = storedTodos.filter((t) => t.status === 'in_progress');
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].content).toBe('Second task');

      // Provider should reflect new state
      const active = storedTodos.filter(
        (todo) => todo.status === 'in_progress' || todo.status === 'pending',
      );
      const formatted = active
        .map((t) => `- [${t.status}] ${t.content}`)
        .join('\n');

      expect(formatted).toContain('- [in_progress] Second task');
      expect(formatted).not.toContain('- [in_progress] First task'); // Now completed
      expect(formatted).toContain('- [pending] Third task');
    });
  });
});
