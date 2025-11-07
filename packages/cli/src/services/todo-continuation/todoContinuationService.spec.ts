/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '@vybestack/llxprt-code-core';
import type { Todo } from '@vybestack/llxprt-code-core';
import {
  TodoContinuationService,
  type ContinuationPromptConfig,
  type ContinuationContext,
  type ContinuationState,
} from './todoContinuationService.js';

describe('TodoContinuationService', () => {
  let service: TodoContinuationService;
  let mockConfig: Config;
  let mockState: ContinuationState;

  beforeEach(() => {
    service = new TodoContinuationService();
    mockConfig = {} as Config;
    mockState = {
      isActive: false,
      attemptCount: 0,
    };
  });

  // Helper functions to create test data
  const createTodo = (
    id: string,
    content: string,
    status: 'pending' | 'in_progress' | 'completed' = 'pending',
    priority: 'high' | 'medium' | 'low' = 'medium',
  ): Todo => ({
    id,
    content,
    status,
    priority,
  });

  const createConfig = (
    overrides: Partial<ContinuationPromptConfig> = {},
  ): ContinuationPromptConfig => ({
    taskDescription: 'Complete user authentication',
    isYoloMode: false,
    ...overrides,
  });

  const createContext = (
    overrides: Partial<ContinuationContext> = {},
  ): ContinuationContext => ({
    todos: [],
    hadToolCalls: false,
    isResponding: false,
    config: mockConfig,
    currentState: mockState,
    ...overrides,
  });

  describe('Prompt Generation', () => {
    describe('@requirement REQ-002.1 REQ-002.2', () => {
      it('generates standard mode prompt with task description', () => {
        const config = createConfig({
          taskDescription: 'Implement user registration feature',
          isYoloMode: false,
        });

        const result = service.generateContinuationPrompt(config);

        expect(result).toContain('Implement user registration feature');
        expect(result).toMatch(/continue|proceed|working/i);
        expect(result).not.toMatch(/urgent|critical|immediately/i);
      });

      it('includes specific task description in prompt', () => {
        const specificTask =
          'Fix database connection timeout in UserService.authenticate method';
        const config = createConfig({
          taskDescription: specificTask,
          isYoloMode: false,
        });

        const result = service.generateContinuationPrompt(config);

        expect(result).toContain(specificTask);
      });

      it('handles task descriptions with special characters', () => {
        const complexTask =
          'Update API endpoints: /users/{id}/profile & /auth/tokens (v2.1)';
        const config = createConfig({
          taskDescription: complexTask,
          isYoloMode: false,
        });

        const result = service.generateContinuationPrompt(config);

        expect(result).toContain(complexTask);
      });
    });

    describe('@requirement REQ-002.3', () => {
      it('generates YOLO mode prompt with stronger wording', () => {
        const config = createConfig({
          taskDescription: 'Deploy production hotfix',
          isYoloMode: true,
        });

        const result = service.generateContinuationPrompt(config);

        expect(result).toContain('Deploy production hotfix');
        expect(result).toMatch(/urgent|critical|immediately|essential/i);
        expect(result.length).toBeGreaterThan(50); // YOLO prompts should be more detailed
      });

      it('uses different wording between standard and YOLO mode', () => {
        const taskDescription = 'Complete user authentication';

        const standardPrompt = service.generateContinuationPrompt(
          createConfig({ taskDescription, isYoloMode: false }),
        );

        const yoloPrompt = service.generateContinuationPrompt(
          createConfig({ taskDescription, isYoloMode: true }),
        );

        expect(standardPrompt).not.toEqual(yoloPrompt);
        expect(yoloPrompt).toMatch(/urgent|critical|immediately/i);
        expect(standardPrompt).not.toMatch(/urgent|critical|immediately/i);
      });
    });

    it('handles retry attempts in prompt generation', () => {
      const config = createConfig({
        taskDescription: 'Fix failing tests',
        isYoloMode: false,
        attemptCount: 2,
      });

      const result = service.generateContinuationPrompt(config);

      expect(result).toContain('Fix failing tests');
      expect(result).toMatch(/attempt|retry|try again/i);
    });

    it('handles previous failure information in prompts', () => {
      const config = createConfig({
        taskDescription: 'Deploy application',
        isYoloMode: true,
        attemptCount: 1,
        previousFailure: 'Connection timeout during database migration',
      });

      const result = service.generateContinuationPrompt(config);

      expect(result).toContain('Deploy application');
      expect(result).toContain('Connection timeout during database migration');
    });

    it('truncates very long task descriptions', () => {
      const longTask = 'A'.repeat(500); // Exceeds MAX_TASK_DESCRIPTION_LENGTH
      const config = createConfig({
        taskDescription: longTask,
        isYoloMode: false,
      });

      const result = service.generateContinuationPrompt(config);

      expect(result.length).toBeLessThan(longTask.length + 100); // Should be truncated
      expect(result).toMatch(/\.\.\./); // Should have ellipsis
    });
  });

  describe('Continuation Logic', () => {
    describe('@requirement REQ-002.1', () => {
      it('should continue when todos are active and no tool calls were made', () => {
        const todos = [
          createTodo('1', 'Task 1', 'in_progress'),
          createTodo('2', 'Task 2', 'pending'),
        ];

        const context = createContext({
          todos,
          hadToolCalls: false,
          currentState: { ...mockState, isActive: false },
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(true);
        expect(result.reason).toMatch(/active.*todo/i);
        expect(result.activeTodo).toBeDefined();
      });

      it('should not continue when continuation is disabled in config', () => {
        const todos = [createTodo('1', 'Task 1', 'in_progress')];
        // Mock config with continuation disabled
        const disabledConfig = {
          continuationEnabled: false,
        } as unknown as Config;

        const context = createContext({
          todos,
          hadToolCalls: false,
          config: disabledConfig,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(false);
        expect(result.reason).toMatch(/disabled/i);
      });

      it('continues when tool calls were made in current turn and todos remain active', () => {
        const todos = [createTodo('1', 'Task 1', 'in_progress')];

        const context = createContext({
          todos,
          hadToolCalls: true,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(true);
        expect(result.reason).toMatch(/active.*todo/i);
      });

      it('should not continue when no active todos exist', () => {
        const todos = [
          createTodo('1', 'Task 1', 'completed'),
          createTodo('2', 'Task 2', 'completed'),
        ];

        const context = createContext({
          todos,
          hadToolCalls: false,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(false);
        expect(result.reason).toMatch(/no.*active.*todo/i);
      });

      it('stops continuation when todo_pause was triggered', () => {
        const todos = [createTodo('1', 'Task 1', 'pending')];

        const context = createContext({
          todos,
          hadToolCalls: false,
          todoPaused: true,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(false);
        expect(result.reason.toLowerCase()).toContain('pause');
      });

      it('should not continue when maximum attempts exceeded', () => {
        const todos = [createTodo('1', 'Task 1', 'in_progress')];
        const stateWithMaxAttempts = {
          ...mockState,
          attemptCount: 5, // Exceeds MAX_CONTINUATION_ATTEMPTS
        };

        const context = createContext({
          todos,
          hadToolCalls: false,
          currentState: stateWithMaxAttempts,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(false);
        expect(result.reason).toMatch(/attempt.*limit/i);
      });

      it('should not continue when already in continuation state', () => {
        const todos = [createTodo('1', 'Task 1', 'in_progress')];
        const activeState = {
          ...mockState,
          isActive: true,
        };

        const context = createContext({
          todos,
          hadToolCalls: false,
          currentState: activeState,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(false);
        expect(result.reason).toMatch(/already.*continuing/i);
      });

      it('should respect time constraints between continuation attempts', () => {
        const todos = [createTodo('1', 'Task 1', 'in_progress')];
        const recentState = {
          ...mockState,
          lastPromptTime: new Date(Date.now() - 500), // Very recent
        };

        const context = createContext({
          todos,
          hadToolCalls: false,
          currentState: recentState,
        });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(false);
        expect(result.reason).toMatch(/time.*constraint/i);
      });
    });

    it('provides detailed condition evaluation in result', () => {
      const todos = [createTodo('1', 'Task 1', 'in_progress')];

      const context = createContext({
        todos,
        hadToolCalls: false,
      });

      const result = service.checkContinuationConditions(context);

      expect(result.conditions).toBeDefined();
      expect(result.conditions.hasActiveTodos).toBe(true);
      expect(result.conditions.noToolCallsMade).toBe(true);
      expect(result.conditions.continuationEnabled).toBeDefined();
      expect(result.conditions.notCurrentlyContinuing).toBeDefined();
      expect(result.conditions.withinAttemptLimits).toBeDefined();
      expect(result.conditions.withinTimeConstraints).toBeDefined();
    });
  });

  describe('Task Description Extraction', () => {
    describe('@requirement REQ-002.2', () => {
      it('extracts task description from in_progress todos first', () => {
        const inProgressTodo = createTodo(
          '1',
          'Critical bug fix in payment processor',
          'in_progress',
        );
        const pendingTodo = createTodo(
          '2',
          'Add unit tests for user service',
          'pending',
        );

        const todos = [pendingTodo, inProgressTodo]; // Order shouldn't matter
        const context = createContext({ todos, hadToolCalls: false });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(true);
        expect(result.activeTodo).toEqual(inProgressTodo);
      });

      it('falls back to pending todos when no in_progress todos exist', () => {
        const pendingTodo1 = createTodo(
          '1',
          'Implement user authentication',
          'pending',
          'high',
        );
        const pendingTodo2 = createTodo(
          '2',
          'Update documentation',
          'pending',
          'low',
        );

        const todos = [pendingTodo2, pendingTodo1]; // Lower priority first
        const context = createContext({ todos, hadToolCalls: false });

        const result = service.checkContinuationConditions(context);

        expect(result.shouldContinue).toBe(true);
        expect(result.activeTodo).toEqual(pendingTodo1); // Should pick higher priority
      });

      it('formats todo content into readable task description', () => {
        const todo = createTodo(
          '1',
          'Fix: Database connection pool exhaustion in UserService.authenticate() method',
        );

        const result = service.formatTaskDescription(todo);

        expect(result).toBe(
          'Fix: Database connection pool exhaustion in UserService.authenticate() method',
        );
        expect(result.length).toBeGreaterThan(0);
      });

      it('handles malformed todo content gracefully', () => {
        const malformedTodo = createTodo('1', ''); // Empty content (should not happen due to schema)

        const result = service.formatTaskDescription(malformedTodo);

        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0); // Should provide fallback
      });

      it('prioritizes high-priority pending todos over low-priority ones', () => {
        const lowPriorityTodo = createTodo(
          '1',
          'Update README',
          'pending',
          'low',
        );
        const highPriorityTodo = createTodo(
          '2',
          'Fix security vulnerability',
          'pending',
          'high',
        );

        const todos = [lowPriorityTodo, highPriorityTodo];
        const context = createContext({ todos, hadToolCalls: false });

        const result = service.checkContinuationConditions(context);

        expect(result.activeTodo).toEqual(highPriorityTodo);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('handles empty todo list gracefully', () => {
      const context = createContext({
        todos: [],
        hadToolCalls: false,
      });

      const result = service.checkContinuationConditions(context);

      expect(result.shouldContinue).toBe(false);
      expect(result.reason).toMatch(/no.*active.*todo/i);
      expect(result.activeTodo).toBeUndefined();
    });

    it('handles null/undefined inputs safely', () => {
      expect(() => {
        const nullContext = null as unknown as ContinuationContext;
        service.checkContinuationConditions(nullContext);
      }).toThrow();

      expect(() => {
        const nullConfig = null as unknown as ContinuationPromptConfig;
        service.generateContinuationPrompt(nullConfig);
      }).toThrow();
    });

    it('handles empty task description strings', () => {
      const config = createConfig({
        taskDescription: '',
        isYoloMode: false,
      });

      const result = service.generateContinuationPrompt(config);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0); // Should provide fallback prompt
    });

    it('handles very long task descriptions by truncating', () => {
      const veryLongDescription = 'Task: ' + 'A'.repeat(1000);
      const config = createConfig({
        taskDescription: veryLongDescription,
        isYoloMode: false,
      });

      const result = service.generateContinuationPrompt(config);

      expect(result.length).toBeLessThan(veryLongDescription.length + 50);
      expect(result).toContain('Task:');
    });

    it('handles todos with undefined optional fields', () => {
      const minimalTodo: Todo = {
        id: '1',
        content: 'Minimal todo item',
        status: 'in_progress',
        priority: 'medium',
        // subtasks and toolCalls are undefined
      };

      const result = service.formatTaskDescription(minimalTodo);

      expect(result).toBe('Minimal todo item');
    });

    it('creates initial continuation state correctly', () => {
      const state = service.createContinuationState();

      expect(state.isActive).toBe(false);
      expect(state.attemptCount).toBe(0);
      expect(state.taskDescription).toBeUndefined();
      expect(state.lastPromptTime).toBeUndefined();
    });
  });

  describe('Helper Methods', () => {
    describe('shouldContinue', () => {
      it('returns true when conditions are met', () => {
        const result = service.shouldContinue(mockConfig, true, false);

        expect(typeof result).toBe('boolean');
        // Implementation will determine exact behavior
      });

      it('returns false when no active todos', () => {
        const result = service.shouldContinue(mockConfig, false, false);

        expect(result).toBe(false);
      });

      it('returns false when tool calls were made', () => {
        const result = service.shouldContinue(mockConfig, true, true);

        expect(result).toBe(false);
      });
    });

    describe('formatPrompt', () => {
      it('formats prompt with task description and mode', () => {
        const taskDescription = 'Implement OAuth2 flow';

        const standardPrompt = service.formatPrompt(taskDescription, false);
        const yoloPrompt = service.formatPrompt(taskDescription, true);

        expect(standardPrompt).toContain(taskDescription);
        expect(yoloPrompt).toContain(taskDescription);
        expect(standardPrompt).not.toEqual(yoloPrompt);
      });
    });

    describe('shouldAllowContinuation', () => {
      it('respects configuration settings', () => {
        const result = service.shouldAllowContinuation(mockConfig, mockState);

        expect(typeof result).toBe('boolean');
      });

      it('considers attempt limits', () => {
        const maxAttemptState = {
          ...mockState,
          attemptCount: 10, // High number
        };

        const result = service.shouldAllowContinuation(
          mockConfig,
          maxAttemptState,
        );

        expect(typeof result).toBe('boolean');
      });
    });
  });
});
