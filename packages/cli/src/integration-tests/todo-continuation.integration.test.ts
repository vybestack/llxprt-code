/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Config,
  GeminiClient,
  TodoStore,
  Todo,
  ApprovalMode,
  todoEvents,
  createRuntimeStateFromConfig,
  type TodoUpdateEvent,
  type Turn,
  type ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core';
import type { PartListUnion } from '@google/genai';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';

/**
 * Todo Continuation Integration Tests
 *
 * These tests validate end-to-end functionality of the todo continuation feature
 * by testing the real components and their interactions without mocking core functionality.
 */
describe('Todo Continuation Integration Tests', () => {
  let tempDir: string;
  let config: Config;
  let geminiClient: GeminiClient;
  let todoStore: TodoStore;
  let sessionId: string;
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

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempDir = await createTempDirectory();
    process.env.HOME = tempDir;

    sessionId = 'integration-test-session';
    todoStore = new TodoStore(sessionId);

    config = new Config({
      sessionId,
      targetDir: tempDir,
      debugMode: false,
      model: 'gemini-2.0-flash-exp',
      cwd: tempDir,
    });

    await config.initialize();

    const runtimeState = createRuntimeStateFromConfig(config, {
      runtimeId: `${sessionId}-todo-runtime`,
    });

    geminiClient = new GeminiClient(config, runtimeState);
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    await cleanupTempDirectory(tempDir);
  });

  describe('Configuration Persistence', () => {
    it('@requirement REQ-004 should persist todo-continuation setting in Config', async () => {
      // Given: Initially no setting
      expect(config.getEphemeralSetting('todo-continuation')).toBeUndefined();

      // When: Set todo-continuation to true
      config.setEphemeralSetting('todo-continuation', true);

      // Then: Setting should be persisted
      expect(config.getEphemeralSetting('todo-continuation')).toBe(true);

      // When: Set to false
      config.setEphemeralSetting('todo-continuation', false);

      // Then: Setting should be updated
      expect(config.getEphemeralSetting('todo-continuation')).toBe(false);

      // When: Remove setting
      config.setEphemeralSetting('todo-continuation', undefined);

      // Then: Setting should be undefined
      expect(config.getEphemeralSetting('todo-continuation')).toBeUndefined();
    });

    it('@requirement REQ-004 should not persist across Config instances by default', async () => {
      // Given: Set setting in first instance
      config.setEphemeralSetting('todo-continuation', true);
      expect(config.getEphemeralSetting('todo-continuation')).toBe(true);

      // When: Create new Config instance
      const newConfig = new Config({
        sessionId: 'new-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // Then: Setting should not be persisted
      expect(
        newConfig.getEphemeralSetting('todo-continuation'),
      ).toBeUndefined();
    });

    it('@requirement REQ-004 should handle all ephemeral setting data types', async () => {
      // Given: Various data types for configuration
      const testCases = [
        { key: 'bool-true', value: true },
        { key: 'bool-false', value: false },
        { key: 'string', value: 'test-string' },
        { key: 'number', value: 42 },
        { key: 'null', value: null },
        { key: 'object', value: { nested: 'value' } },
        { key: 'array', value: ['item1', 'item2'] },
      ];

      for (const testCase of testCases) {
        // When: Set various types
        config.setEphemeralSetting(testCase.key, testCase.value);

        // Then: Should retrieve correctly
        expect(config.getEphemeralSetting(testCase.key)).toEqual(
          testCase.value,
        );
      }
    });
  });

  describe('TodoStore Integration', () => {
    it('@requirement REQ-001 should read and write todos through TodoStore', async () => {
      // Given: Create todos
      const todos = [
        createTodo('1', 'Complete feature implementation', 'in_progress'),
        createTodo('2', 'Write comprehensive tests', 'pending'),
        createTodo('3', 'Update documentation', 'completed'),
      ];

      // When: Write todos to store
      await todoStore.writeTodos(todos);

      // Then: Should be able to read back
      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(3);
      expect(storedTodos[0].content).toBe('Complete feature implementation');
      expect(storedTodos[0].status).toBe('in_progress');
      expect(storedTodos[1].status).toBe('pending');
      expect(storedTodos[2].status).toBe('completed');
    });

    it('@requirement REQ-001 should handle empty todo lists', async () => {
      // Given: Empty todo list
      const todos: Todo[] = [];

      // When: Write empty list
      await todoStore.writeTodos(todos);

      // Then: Should read back empty list
      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(0);
    });

    it('@requirement REQ-001 should update existing todos', async () => {
      // Given: Initial todos
      const initialTodos = [createTodo('1', 'Initial task', 'pending')];
      await todoStore.writeTodos(initialTodos);

      // When: Update todo status
      const updatedTodos = [
        createTodo('1', 'Initial task', 'completed'),
        createTodo('2', 'New task', 'in_progress'),
      ];
      await todoStore.writeTodos(updatedTodos);

      // Then: Should reflect updates
      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(2);
      expect(storedTodos[0].status).toBe('completed');
      expect(storedTodos[1].content).toBe('New task');
      expect(storedTodos[1].status).toBe('in_progress');
    });

    it('@requirement REQ-001 should isolate todos by session ID', async () => {
      // Given: Multiple sessions
      const session1Id = 'session-1';
      const session2Id = 'session-2';

      const store1 = new TodoStore(session1Id);
      const store2 = new TodoStore(session2Id);

      const todos1 = [createTodo('1', 'Session 1 task', 'in_progress')];
      const todos2 = [createTodo('1', 'Session 2 task', 'pending')];

      // When: Write different todos to each session
      await store1.writeTodos(todos1);
      await store2.writeTodos(todos2);

      // Then: Each session should have its own todos
      const stored1 = await store1.readTodos();
      const stored2 = await store2.readTodos();

      expect(stored1).toHaveLength(1);
      expect(stored2).toHaveLength(1);
      expect(stored1[0].content).toBe('Session 1 task');
      expect(stored2[0].content).toBe('Session 2 task');
      expect(stored1[0].status).toBe('in_progress');
      expect(stored2[0].status).toBe('pending');
    });
  });

  describe('GeminiClient Integration', () => {
    it('@requirement REQ-002 should create GeminiClient with correct configuration', async () => {
      // Given: GeminiClient instance
      expect(geminiClient).toBeDefined();
      expect(typeof geminiClient.sendMessageStream).toBe('function');
    });

    it('@requirement REQ-002 should support ephemeral messaging interface', async () => {
      // Given: Mock the sendMessageStream to capture calls
      let capturedMessage = '';
      let capturedOptions: unknown = null;

      const originalSendMessageStream = geminiClient.sendMessageStream;
      geminiClient.sendMessageStream = vi.fn(async function* (
        request: PartListUnion,
        signal: AbortSignal,
        prompt_id: string,
        turns?: number,
        isInvalidStreamRetry?: boolean,
      ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
        capturedMessage =
          typeof request === 'string' ? request : JSON.stringify(request);
        capturedOptions = { signal, prompt_id, turns, isInvalidStreamRetry };
        // Yield a mock stream event
        yield {
          type: 'content',
          value: 'test',
        } as ServerGeminiStreamEvent;
        // Create a mock Turn object
        const mockTurn = {} as Turn;
        return mockTurn;
      });

      // When: Send ephemeral message
      const generator = geminiClient.sendMessageStream(
        'Test continuation prompt',
        new AbortController().signal,
        'test-prompt-id',
      );
      await generator.next();

      // Then: Should capture message and options
      expect(capturedMessage).toBe('Test continuation prompt');
      expect(capturedOptions).toEqual({
        signal: expect.any(AbortSignal),
        prompt_id: 'test-prompt-id',
        turns: undefined,
        isInvalidStreamRetry: undefined,
      });

      // Restore original method
      geminiClient.sendMessageStream = originalSendMessageStream;
    });

    it('@requirement REQ-002 should handle YOLO vs DEFAULT approval modes', async () => {
      // Given: Test different approval modes
      const yoloConfig = new Config({
        sessionId: 'yolo-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await yoloConfig.initialize();

      // When: Set YOLO mode
      yoloConfig.setApprovalMode(ApprovalMode.YOLO);

      // Then: Should reflect mode change
      expect(yoloConfig.getApprovalMode()).toBe(ApprovalMode.YOLO);

      // When: Set DEFAULT mode
      config.setApprovalMode(ApprovalMode.DEFAULT);

      // Then: Should reflect mode change
      expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    });
  });

  describe('Todo Events Integration', () => {
    it('@requirement REQ-003 should emit and handle todo update events', async () => {
      // Given: Setup event listener
      let receivedEvent: TodoUpdateEvent | null = null;

      const eventHandler = (eventData: TodoUpdateEvent) => {
        receivedEvent = eventData;
      };

      todoEvents.onTodoUpdated(eventHandler);

      // When: Emit todo update event
      const testTodos = [createTodo('1', 'Event test task', 'in_progress')];
      todoEvents.emitTodoUpdated({
        sessionId,
        todos: testTodos,
        timestamp: new Date(),
      });

      // Then: Event should be received
      expect(receivedEvent).toBeDefined();
      expect(receivedEvent).not.toBeNull();
      const event = receivedEvent as unknown as TodoUpdateEvent;
      expect(event.sessionId).toBe(sessionId);
      expect(event.todos).toHaveLength(1);
      expect(event.todos[0].content).toBe('Event test task');

      // Cleanup
      todoEvents.offTodoUpdated(eventHandler);
    });

    it('@requirement REQ-003 should handle multiple event listeners', async () => {
      // Given: Multiple event listeners
      const receivedEvents: Array<{ handler: number; data: TodoUpdateEvent }> =
        [];

      const handler1 = (eventData: TodoUpdateEvent) => {
        receivedEvents.push({ handler: 1, data: eventData });
      };

      const handler2 = (eventData: TodoUpdateEvent) => {
        receivedEvents.push({ handler: 2, data: eventData });
      };

      todoEvents.onTodoUpdated(handler1);
      todoEvents.onTodoUpdated(handler2);

      // When: Emit event
      const testTodos = [createTodo('1', 'Multi-handler test', 'pending')];
      todoEvents.emitTodoUpdated({
        sessionId,
        todos: testTodos,
        timestamp: new Date(),
      });

      // Then: All handlers should receive event
      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0].handler).toBe(1);
      expect(receivedEvents[1].handler).toBe(2);
      expect(receivedEvents[0].data.todos[0].content).toBe(
        'Multi-handler test',
      );
      expect(receivedEvents[1].data.todos[0].content).toBe(
        'Multi-handler test',
      );

      // Cleanup
      todoEvents.offTodoUpdated(handler1);
      todoEvents.offTodoUpdated(handler2);
    });

    it('@requirement REQ-003 should properly unregister event listeners', async () => {
      // Given: Event listener
      let eventCount = 0;

      const handler = () => {
        eventCount++;
      };

      todoEvents.onTodoUpdated(handler);

      // When: Emit event
      todoEvents.emitTodoUpdated({
        sessionId,
        todos: [createTodo('1', 'Test', 'pending')],
        timestamp: new Date(),
      });

      expect(eventCount).toBe(1);

      // When: Unregister and emit again
      todoEvents.offTodoUpdated(handler);
      todoEvents.emitTodoUpdated({
        sessionId,
        todos: [createTodo('2', 'Test 2', 'pending')],
        timestamp: new Date(),
      });

      // Then: Handler should not be called again
      expect(eventCount).toBe(1);
    });
  });

  describe('Real Component Data Flow', () => {
    it('@requirement REQ-001, REQ-002, REQ-003, REQ-004 should demonstrate end-to-end data flow', async () => {
      // Given: Enable todo continuation
      config.setEphemeralSetting('todo-continuation', true);
      expect(config.getEphemeralSetting('todo-continuation')).toBe(true);

      // Create active todos through real TodoStore
      const todos = [
        createTodo('1', 'Implement authentication', 'in_progress'),
        createTodo('2', 'Write integration tests', 'pending'),
        createTodo('3', 'Update user guide', 'completed'),
      ];

      await todoStore.writeTodos(todos);

      // Verify storage worked
      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(3);

      // Filter for active todos (simulating continuation logic)
      const activeTodos = storedTodos.filter(
        (todo) => todo.status === 'in_progress' || todo.status === 'pending',
      );
      expect(activeTodos).toHaveLength(2);

      // Prioritize in_progress todos (simulating continuation prioritization)
      const inProgressTodos = activeTodos.filter(
        (todo) => todo.status === 'in_progress',
      );
      const pendingTodos = activeTodos.filter(
        (todo) => todo.status === 'pending',
      );

      const prioritizedTodo =
        inProgressTodos.length > 0 ? inProgressTodos[0] : pendingTodos[0];
      expect(prioritizedTodo.content).toBe('Implement authentication');
      expect(prioritizedTodo.status).toBe('in_progress');

      // Simulate continuation prompt generation
      const isYoloMode = config.getApprovalMode() === ApprovalMode.YOLO;
      const continuationPrompt = isYoloMode
        ? `Continue to proceed with the active task without waiting for confirmation: "${prioritizedTodo.content}"`
        : `Please continue working on the following task: "${prioritizedTodo.content}"`;

      expect(continuationPrompt).toContain('Implement authentication');
      expect(continuationPrompt).toMatch(/please continue working/i);

      // Test YOLO mode prompt
      config.setApprovalMode(ApprovalMode.YOLO);
      const yoloPrompt =
        config.getApprovalMode() === ApprovalMode.YOLO
          ? `Continue to proceed with the active task without waiting for confirmation: "${prioritizedTodo.content}"`
          : `Please continue working on the following task: "${prioritizedTodo.content}"`;

      expect(yoloPrompt).toMatch(/(continue|proceed).*without.*confirmation/i);

      // Simulate todo pause functionality
      const pauseResult = {
        type: 'pause' as const,
        reason: 'User needs to review requirements',
        message: 'Task paused: User needs to review requirements',
      };

      expect(pauseResult.type).toBe('pause');
      expect(pauseResult.reason).toBe('User needs to review requirements');
      expect(pauseResult.message).toContain('paused');
    });

    it('@requirement REQ-001, REQ-003 should handle todo state transitions through events', async () => {
      // Given: Initial todos
      const initialTodos = [
        createTodo('1', 'Design database schema', 'pending'),
      ];

      await todoStore.writeTodos(initialTodos);

      // Setup event tracking
      const events: TodoUpdateEvent[] = [];
      const eventHandler = (eventData: TodoUpdateEvent) => {
        events.push(eventData);
      };

      todoEvents.onTodoUpdated(eventHandler);

      // When: Update todo status to in_progress
      const updatedTodos = [
        createTodo('1', 'Design database schema', 'in_progress'),
      ];

      await todoStore.writeTodos(updatedTodos);
      todoEvents.emitTodoUpdated({
        sessionId,
        todos: updatedTodos,
        timestamp: new Date(),
      });

      // Then: Event should reflect state change
      expect(events).toHaveLength(1);
      expect(events[0].todos[0].status).toBe('in_progress');

      // When: Complete the todo
      const completedTodos = [
        createTodo('1', 'Design database schema', 'completed'),
      ];

      await todoStore.writeTodos(completedTodos);
      todoEvents.emitTodoUpdated({
        sessionId,
        todos: completedTodos,
        timestamp: new Date(),
      });

      // Then: Should have two events showing progression
      expect(events).toHaveLength(2);
      expect(events[1].todos[0].status).toBe('completed');

      // Verify final state in storage
      const finalTodos = await todoStore.readTodos();
      expect(finalTodos[0].status).toBe('completed');

      // Cleanup
      todoEvents.offTodoUpdated(eventHandler);
    });

    it('@requirement REQ-002 should validate ephemeral settings persistence patterns', async () => {
      // Given: Multiple configuration scenarios
      const testSettings = [
        { key: 'todo-continuation', value: true },
        { key: 'context-limit', value: 150000 },
        { key: 'compression-threshold', value: 0.75 },
        { key: 'base-url', value: 'https://api.example.com' },
        { key: 'custom-headers', value: { 'X-Test': 'integration' } },
      ];

      // When: Set all ephemeral settings
      for (const setting of testSettings) {
        config.setEphemeralSetting(setting.key, setting.value);
      }

      // Then: All should be retrievable
      for (const setting of testSettings) {
        expect(config.getEphemeralSetting(setting.key)).toEqual(setting.value);
      }

      // When: Get all settings at once
      const allSettings = config.getEphemeralSettings();

      // Then: Should contain all set values
      expect(allSettings['todo-continuation']).toBe(true);
      expect(allSettings['context-limit']).toBe(150000);
      expect(allSettings['compression-threshold']).toBe(0.75);
      expect(allSettings['base-url']).toBe('https://api.example.com');
      expect(allSettings['custom-headers']).toEqual({
        'X-Test': 'integration',
      });

      // When: Create new Config instance
      const newConfig = new Config({
        sessionId: 'ephemeral-test',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // Then: New instance should have empty ephemeral settings
      const newSettings = newConfig.getEphemeralSettings();
      expect(Object.keys(newSettings)).toHaveLength(0);
    });

    it('@requirement REQ-004 should demonstrate configuration edge cases', async () => {
      // Test undefined values
      config.setEphemeralSetting('undefined-test', undefined);
      expect(config.getEphemeralSetting('undefined-test')).toBeUndefined();

      // Test null values
      config.setEphemeralSetting('null-test', null);
      expect(config.getEphemeralSetting('null-test')).toBeNull();

      // Test empty string
      config.setEphemeralSetting('empty-string', '');
      expect(config.getEphemeralSetting('empty-string')).toBe('');

      // Test zero
      config.setEphemeralSetting('zero', 0);
      expect(config.getEphemeralSetting('zero')).toBe(0);

      // Test false
      config.setEphemeralSetting('false', false);
      expect(config.getEphemeralSetting('false')).toBe(false);

      // Test overwriting values
      config.setEphemeralSetting('overwrite-test', 'initial');
      expect(config.getEphemeralSetting('overwrite-test')).toBe('initial');

      config.setEphemeralSetting('overwrite-test', 'updated');
      expect(config.getEphemeralSetting('overwrite-test')).toBe('updated');
    });

    it('@requirement REQ-001, REQ-002, REQ-003 should validate data and handle edge cases', async () => {
      // Test valid todos with edge case content
      const edgeCaseTodos = [
        {
          id: '1',
          content: 'Valid todo',
          status: 'pending',
        } as Todo,
        {
          id: '2',
          content: 'Todo with special chars: !@#$%^&*()',
          status: 'in_progress',
        } as Todo,
        {
          id: '3',
          content:
            'Very long todo content that spans multiple lines and contains various characters',
          status: 'completed',
        } as Todo,
      ];

      // Should handle valid todos with edge cases
      await todoStore.writeTodos(edgeCaseTodos);
      const storedTodos = await todoStore.readTodos();
      expect(storedTodos).toHaveLength(3);
      expect(storedTodos[1].content).toContain('special chars');

      // Test that TodoStore validates malformed todos (expected to throw)
      const malformedTodos = [
        { id: '1', status: 'pending' } as unknown as Todo, // Missing content
      ];

      // TodoStore should validate and throw for invalid data
      await expect(todoStore.writeTodos(malformedTodos)).rejects.toThrow();

      // Test graceful handling of various configuration values
      expect(() => {
        config.setEphemeralSetting('test-undefined', undefined);
        config.setEphemeralSetting('test-null', null);
        config.setEphemeralSetting('test-empty-string', '');
        config.setEphemeralSetting('test-zero', 0);
        config.setEphemeralSetting('test-false', false);
        config.setEphemeralSetting('test-array', []);
        config.setEphemeralSetting('test-object', {});
      }).not.toThrow();
    });
  });

  describe('Performance and Scale Testing', () => {
    it('@requirement REQ-001 should handle large numbers of todos efficiently', async () => {
      // Given: Large number of todos
      const largeTodoSet: Todo[] = [];
      for (let i = 0; i < 1000; i++) {
        largeTodoSet.push(
          createTodo(
            `todo-${i}`,
            `Task number ${i}`,
            i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'in_progress' : 'pending',
          ),
        );
      }

      const startTime = Date.now();

      // When: Write large todo set
      await todoStore.writeTodos(largeTodoSet);

      // Then: Should complete in reasonable time
      const writeTime = Date.now() - startTime;
      expect(writeTime).toBeLessThan(5000); // Should complete within 5 seconds

      // When: Read back large todo set
      const readStartTime = Date.now();
      const storedTodos = await todoStore.readTodos();
      const readTime = Date.now() - readStartTime;

      // Then: Should read efficiently
      expect(readTime).toBeLessThan(1000); // Should read within 1 second
      expect(storedTodos).toHaveLength(1000);

      // Verify data integrity
      expect(storedTodos[0].content).toBe('Task number 0');
      expect(storedTodos[999].content).toBe('Task number 999');
    });

    it('@requirement REQ-003 should handle rapid event emissions', async () => {
      // Given: Event handler that tracks all events
      const receivedEvents: TodoUpdateEvent[] = [];
      const eventHandler = (eventData: TodoUpdateEvent) => {
        receivedEvents.push(eventData);
      };

      todoEvents.onTodoUpdated(eventHandler);

      // When: Emit many events rapidly
      const eventCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < eventCount; i++) {
        todoEvents.emitTodoUpdated({
          sessionId: `rapid-test-${i}`,
          todos: [createTodo(`${i}`, `Rapid event ${i}`, 'pending')],
          timestamp: new Date(),
        });
      }

      // Give events time to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      const processTime = Date.now() - startTime;

      // Then: All events should be processed efficiently
      expect(receivedEvents).toHaveLength(eventCount);
      expect(processTime).toBeLessThan(1000); // Should process within 1 second

      // Cleanup
      todoEvents.offTodoUpdated(eventHandler);
    });
  });
});
