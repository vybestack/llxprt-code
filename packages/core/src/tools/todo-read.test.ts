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
      content: 'In progress task',
      status: 'in_progress',
    },
    {
      id: '2',
      content: 'Medium pending task',
      status: 'pending',
    },
    {
      id: '3',
      content: 'Completed task',
      status: 'completed',
    },
    {
      id: '4',
      content: 'Another pending task',
      status: 'pending',
    },
    {
      id: '5',
      content: 'Another completed task',
      status: 'completed',
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

      expect(result.llmContent).toContain('Todo Progress');
      expect(result.llmContent).toContain('No todos found');
      expect(result.returnDisplay).toContain('Todo Progress');
    });

    it('should return todos with proper formatting', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);

      expect(result.llmContent).toContain('Todo Progress');
      expect(result.llmContent).toContain('→ In progress task');
      expect(result.llmContent).toContain('○ Medium pending task');
      expect(result.llmContent).toContain(' Completed task');
    });

    it('should sort todos by status (in_progress > pending > completed)', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);
      const lines = (result.llmContent as string)
        .split('\n')
        .filter((line: string) => line.trim());

      // Find indices of different status todos
      const inProgressIndex = lines.findIndex((line) =>
        line.includes('→ In progress task'),
      );
      const pendingIndex = lines.findIndex((line) =>
        line.includes('○ Medium pending task'),
      );
      const completedIndex = lines.findIndex((line) =>
        line.includes(' Completed task'),
      );

      expect(inProgressIndex).toBeLessThan(pendingIndex);
      expect(pendingIndex).toBeLessThan(completedIndex);
    });

    it('should preserve original array order within same status', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);
      const lines = (result.llmContent as string)
        .split('\n')
        .filter((line: string) => line.trim());

      // "Medium pending task" should come before "Another pending task" (original array order)
      const mediumPendingIndex = lines.findIndex((line) =>
        line.includes('Medium pending task'),
      );
      const anotherPendingIndex = lines.findIndex((line) =>
        line.includes('Another pending task'),
      );

      expect(mediumPendingIndex).toBeLessThan(anotherPendingIndex);
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
      expect(result.llmContent).toContain('Todo Progress');
    });

    it('should include status indicators in output', async () => {
      vi.mocked(TodoStore.prototype.readTodos).mockResolvedValue(sampleTodos);

      const result = await tool.execute({}, abortSignal);

      // Check for status indicators
      expect(result.llmContent).toContain('→'); // in_progress
      expect(result.llmContent).toContain('○'); // pending
      expect(result.llmContent).toContain(''); // completed
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
