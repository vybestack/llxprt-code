/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TodoRead } from './todo-read.js';
import { TodoStore } from './todo-store.js';
import { Todo } from './todo-schemas.js';

// Mock TodoStore
vi.mock('./todo-store.js');

describe('TodoRead', () => {
  let tool: TodoRead;
  const abortSignal = new AbortController().signal;

  const sampleTodos: Todo[] = [
    {
      id: '1',
      content: 'High priority in progress task',
      status: 'in_progress',
      priority: 'high',
    },
    {
      id: '2',
      content: 'Medium priority pending task',
      status: 'pending',
      priority: 'medium',
    },
    {
      id: '3',
      content: 'Low priority completed task',
      status: 'completed',
      priority: 'low',
    },
    {
      id: '4',
      content: 'High priority pending task',
      status: 'pending',
      priority: 'high',
    },
    {
      id: '5',
      content: 'High priority completed task',
      status: 'completed',
      priority: 'high',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new TodoRead();
    new TodoStore('session-123', 'agent-456');
  });

  describe('execute', () => {
    it('should return empty array when no todos exist', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue([]);

      const result = await tool.execute({}, abortSignal);

      expect(result.llmContent).toContain('No todos found');
      expect(result.returnDisplay).toContain('No todos found');
    });

    it('should return todos with proper formatting', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);

      expect(result.llmContent).toContain('High priority in progress task');
      expect(result.llmContent).toContain('Medium priority pending task');
      expect(result.llmContent).toContain('Low priority completed task');
    });

    it('should sort todos by status (in_progress > pending > completed)', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);
      const lines = (result.llmContent as string)
        .split('\n')
        .filter((line: string) => line.trim());

      // Find indices of different status todos
      const inProgressIndex = lines.findIndex((line) =>
        line.includes('High priority in progress task'),
      );
      const pendingIndex = lines.findIndex((line) =>
        line.includes('Medium priority pending task'),
      );
      const completedIndex = lines.findIndex((line) =>
        line.includes('Low priority completed task'),
      );

      expect(inProgressIndex).toBeLessThan(pendingIndex);
      expect(pendingIndex).toBeLessThan(completedIndex);
    });

    it('should sort by priority within same status', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);
      const lines = (result.llmContent as string)
        .split('\n')
        .filter((line: string) => line.trim());

      // High priority pending should come before medium priority pending
      const highPendingIndex = lines.findIndex((line) =>
        line.includes('High priority pending task'),
      );
      const mediumPendingIndex = lines.findIndex((line) =>
        line.includes('Medium priority pending task'),
      );

      expect(highPendingIndex).toBeLessThan(mediumPendingIndex);
    });

    it('should handle read errors gracefully', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockRejectedValue(
        new Error('File read error'),
      );

      await expect(tool.execute({}, abortSignal)).rejects.toThrow(
        'File read error',
      );
    });
  });

  describe('validateToolParams', () => {
    it('should accept empty params object', () => {
      expect(tool.validateToolParams({})).toBeNull();
    });
  });

  describe('getDescription', () => {
    it('should return appropriate description', () => {
      expect(tool.getDescription({})).toContain('todo');
    });
  });

  describe('output format', () => {
    it('should return ToolResult with markdown formatted todo list', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);

      expect(result).toMatchObject({
        llmContent: expect.any(String),
        returnDisplay: expect.any(String),
      });
      expect(result.llmContent).toContain('#');
    });

    it('should include status indicators in output', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);

      // Check for status indicators
      expect(result.llmContent).toMatch(/[\u23f3\ud83d\udd04]/u); // in_progress
      expect(result.llmContent).toMatch(/[\u25cb\u26aa]/u); // pending
      expect(result.llmContent).toMatch(/[\u2713\u2705]/u); // completed
    });

    it('should include priority levels in output', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);

      expect(result.llmContent).toContain('high');
      expect(result.llmContent).toContain('medium');
      expect(result.llmContent).toContain('low');
    });
  });

  describe('session and agent handling', () => {
    it('should use session ID from context', async () => {
      const toolWithSession = Object.assign(
        Object.create(Object.getPrototypeOf(tool)),
        tool,
      );
      toolWithSession.context = {
        sessionId: 'test-session-123',
      };

      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue([]);

      await toolWithSession.execute({}, abortSignal);

      expect(TodoStore).toHaveBeenCalledWith('test-session-123', undefined);
    });

    it('should use agent ID when available', async () => {
      const toolWithAgent = Object.assign(
        Object.create(Object.getPrototypeOf(tool)),
        tool,
      );
      toolWithAgent.context = {
        sessionId: 'test-session-123',
        agentId: 'test-agent-456',
      };

      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue([]);

      await toolWithAgent.execute({}, abortSignal);

      expect(TodoStore).toHaveBeenCalledWith(
        'test-session-123',
        'test-agent-456',
      );
    });

    it('should work without agent ID', async () => {
      const toolNoAgent = Object.assign(
        Object.create(Object.getPrototypeOf(tool)),
        tool,
      );
      toolNoAgent.context = {
        sessionId: 'test-session-123',
      };

      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await toolNoAgent.execute({}, abortSignal);

      expect(result.llmContent).toBeDefined();
      expect(TodoStore).toHaveBeenCalledWith('test-session-123', undefined);
    });
  });
});
