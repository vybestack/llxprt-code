/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TodoStore } from './todo-store.js';
import { Todo } from './todo-schemas.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

describe('TodoStore', () => {
  let tempDir: string;
  let store: TodoStore;
  let sessionId: string;
  const agentId = 'test-agent-456';

  const sampleTodos: Todo[] = [
    {
      id: '1',
      content: 'First task',
      status: 'pending',
    },
    {
      id: '2',
      content: 'Second task',
      status: 'in_progress',
    },
    {
      id: '3',
      content: 'Third task',
      status: 'completed',
    },
  ];

  beforeEach(() => {
    // Create a temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-store-test-'));

    // Use a unique session ID for each test to avoid conflicts
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Mock os.homedir to return our temp directory
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

    store = new TodoStore(sessionId, agentId);
  });

  afterEach(() => {
    // Restore all mocks
    vi.restoreAllMocks();

    // Clean up the temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('readTodos', () => {
    it('should return empty array when no todos exist', async () => {
      const result = await store.readTodos();
      expect(result).toEqual([]);
    });

    it('should read todos from file system', async () => {
      // Write some todos first
      await store.writeTodos(sampleTodos);

      // Read them back
      const result = await store.readTodos();
      expect(result).toEqual(sampleTodos);
    });

    it('should handle missing file gracefully', async () => {
      // Create a new store with a different agent ID to ensure clean state
      const cleanStore = new TodoStore(sessionId, 'non-existent-agent');
      const result = await cleanStore.readTodos();
      expect(result).toEqual([]);
    });
  });

  describe('writeTodos', () => {
    it('should write todos to file system', async () => {
      await store.writeTodos(sampleTodos);

      // Verify we can read back what we wrote
      const result = await store.readTodos();
      expect(result).toEqual(sampleTodos);
    });

    it('should create todos directory if not exists', async () => {
      const todosDir = path.join(tempDir, '.llxprt', 'todos');
      if (fs.existsSync(todosDir)) {
        fs.rmSync(todosDir, { recursive: true });
      }

      // Create a new store instance after directory is removed
      const newStore = new TodoStore(sessionId, agentId);
      await newStore.writeTodos(sampleTodos);

      // Verify we can read back what we wrote (which proves directory was created)
      const result = await newStore.readTodos();
      expect(result).toEqual(sampleTodos);
    });

    it('should overwrite existing todos', async () => {
      // Write initial todos
      await store.writeTodos(sampleTodos);

      // Write different todos
      const newTodos: Todo[] = [
        {
          id: '99',
          content: 'New task',
          status: 'pending',
        },
      ];
      await store.writeTodos(newTodos);

      // Verify only new todos exist
      const result = await store.readTodos();
      expect(result).toEqual(newTodos);
    });

    it('should write empty array when no todos provided', async () => {
      await store.writeTodos([]);

      const result = await store.readTodos();
      expect(result).toEqual([]);
    });
  });

  describe('agent-specific storage', () => {
    it('should use different files for different agents', async () => {
      const store1 = new TodoStore(sessionId, 'agent1');
      const store2 = new TodoStore(sessionId, 'agent2');

      await store1.writeTodos(sampleTodos);
      await store2.writeTodos([]);

      expect(await store1.readTodos()).toEqual(sampleTodos);
      expect(await store2.readTodos()).toEqual([]);
    });

    it('should use session-only file when no agent ID provided', async () => {
      const sessionStore = new TodoStore(sessionId);
      await sessionStore.writeTodos(sampleTodos);

      // Verify we can read back what we wrote
      const result = await sessionStore.readTodos();
      expect(result).toEqual(sampleTodos);

      // Verify that agent-specific store doesn't see session-only todos
      const agentStore = new TodoStore(sessionId, 'different-agent');
      const agentResult = await agentStore.readTodos();
      expect(agentResult).toEqual([]);
    });

    it('should treat default agent id the same as session namespace', async () => {
      const sessionStore = new TodoStore(sessionId);
      await sessionStore.writeTodos(sampleTodos);

      const primaryStore = new TodoStore(sessionId, DEFAULT_AGENT_ID);
      const primaryResult = await primaryStore.readTodos();

      expect(primaryResult).toEqual(sampleTodos);
    });
  });

  describe('concurrent access', () => {
    it('should handle multiple simultaneous reads safely', async () => {
      await store.writeTodos(sampleTodos);

      const promises = Array(10)
        .fill(null)
        .map(() => store.readTodos());

      const results = await Promise.all(promises);
      results.forEach((result) => {
        expect(result).toEqual(sampleTodos);
      });
    });

    it('should handle simultaneous read and write', async () => {
      const readPromise = store.readTodos();
      const writePromise = store.writeTodos(sampleTodos);

      await Promise.all([readPromise, writePromise]);

      // Verify write succeeded
      const result = await store.readTodos();
      expect(result).toEqual(sampleTodos);
    });
  });

  describe('file path generation', () => {
    it('should generate correct file path for session and agent', async () => {
      // This test verifies the private getFilePath method indirectly
      await store.writeTodos(sampleTodos);

      // Verify we can read back what we wrote
      const result = await store.readTodos();
      expect(result).toEqual(sampleTodos);

      // Verify that a different agent doesn't see these todos
      const differentAgentStore = new TodoStore(sessionId, 'different-agent');
      const differentResult = await differentAgentStore.readTodos();
      expect(differentResult).toEqual([]);
    });
  });
});
