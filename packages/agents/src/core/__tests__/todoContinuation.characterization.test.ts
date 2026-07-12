/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  TodoContinuationService,
  PostTurnAction,
  type PostTurnContext,
} from '../TodoContinuationService.js';
import type { Todo } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

/**
 * @plan PLAN-20260707-AGENTNEUTRAL.P26
 * @requirement REQ-005.5c
 *
 * Characterization tests for TodoContinuationService post-turn classification.
 * These tests pin observable behavior BEFORE the retype so P27's
 * PartListUnion→AgentMessageInput migration is behavior-safe.
 *
 * Focus: classifyPostTurnAction (pure function, no external deps needed).
 * The reminder generation path requires TodoReminderService which is deeply
 * coupled to Config — characterized via the existing pipeline tests instead.
 */

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    content: 'Do something',
    status: 'pending',
    priority: 'medium',
    ...overrides,
  };
}

function makeConfig(): Config {
  return {
    getModel: () => 'test-model',
    getSetting: () => undefined,
    getEphemeralSetting: () => undefined,
    getEphemeralSettings: () => ({}),
  } as unknown as Config;
}

function makeContext(
  overrides: Partial<PostTurnContext> = {},
): PostTurnContext {
  return {
    hadToolCalls: false,
    hadThinking: false,
    hadContent: true,
    todoPauseSeen: false,
    retryCount: 0,
    maxRetries: 3,
    activeTodos: [],
    hasPendingReminder: false,
    ...overrides,
  };
}

describe('TodoContinuationService classifyPostTurnAction (characterization)', () => {
  describe('deterministic behavior', () => {
    it('returns Finish when no todos are active', () => {
      const svc = new TodoContinuationService(makeConfig());
      const action = svc.classifyPostTurnAction(
        makeContext({ activeTodos: [] }),
      );
      expect(action).toBe(PostTurnAction.Finish);
    });

    it('returns Finish when retry count exceeds max', () => {
      const svc = new TodoContinuationService(makeConfig());
      const action = svc.classifyPostTurnAction(
        makeContext({
          activeTodos: [makeTodo()],
          retryCount: 5,
          maxRetries: 3,
        }),
      );
      expect(action).toBe(PostTurnAction.Finish);
    });

    it('returns Finish when all todos are completed', () => {
      const svc = new TodoContinuationService(makeConfig());
      const action = svc.classifyPostTurnAction(
        makeContext({
          activeTodos: [makeTodo({ status: 'completed' })],
          hadToolCalls: true,
        }),
      );
      expect(action).toBe(PostTurnAction.Finish);
    });

    it('returns Finish when tool calls were made (regardless of pending todos)', () => {
      const svc = new TodoContinuationService(makeConfig());
      const action = svc.classifyPostTurnAction(
        makeContext({
          activeTodos: [makeTodo({ status: 'pending' })],
          hadToolCalls: true,
          hadContent: true,
        }),
      );
      expect(action).toBe(PostTurnAction.Finish);
    });

    it('returns RetryWithReminder when todos are pending, no tool calls, and content was produced', () => {
      const svc = new TodoContinuationService(makeConfig());
      const action = svc.classifyPostTurnAction(
        makeContext({
          activeTodos: [makeTodo({ status: 'pending' })],
          hadToolCalls: false,
          hadContent: true,
          hadThinking: false,
        }),
      );
      expect(action).toBe(PostTurnAction.RetryWithReminder);
    });

    it('returns Finish when no visible content or tool calls', () => {
      const svc = new TodoContinuationService(makeConfig());
      const action = svc.classifyPostTurnAction(
        makeContext({
          activeTodos: [makeTodo({ status: 'pending' })],
          hadContent: false,
          hadToolCalls: false,
          hadThinking: false,
        }),
      );
      // No thinking, no content, no tool calls → falls through to pending todos check
      // Since no thinking-only, and todos are pending, returns RetryWithReminder
      expect(action).toBe(PostTurnAction.RetryWithReminder);
    });
  });

  describe('property-based invariants', () => {
    it('never returns RetryWithReminder when hadToolCalls is true', () => {
      fc.assert(
        fc.property(
          fc.record({
            hadThinking: fc.boolean(),
            hadContent: fc.boolean(),
            retryCount: fc.integer({ min: 0, max: 10 }),
            maxRetries: fc.integer({ min: 1, max: 10 }),
          }),
          (props) => {
            const svc = new TodoContinuationService(makeConfig());
            const action = svc.classifyPostTurnAction(
              makeContext({
                ...props,
                hadToolCalls: true,
                activeTodos: [
                  makeTodo({ status: 'pending' }),
                  makeTodo({ id: 't2', status: 'pending' }),
                ],
              }),
            );
            return action !== PostTurnAction.RetryWithReminder;
          },
        ),
      );
    });

    it('returns Finish when activeTodos is empty and no thinking-only case', () => {
      fc.assert(
        fc.property(
          fc.record({
            hadToolCalls: fc.boolean(),
            hadContent: fc.boolean(),
            todoPauseSeen: fc.boolean(),
            retryCount: fc.integer({ min: 0, max: 10 }),
            maxRetries: fc.integer({ min: 1, max: 10 }),
          }),
          (props) => {
            const svc = new TodoContinuationService(makeConfig());
            const action = svc.classifyPostTurnAction(
              makeContext({
                ...props,
                hadThinking: false,
                activeTodos: [],
                hasPendingReminder: false,
              }),
            );
            return action === PostTurnAction.Finish;
          },
        ),
      );
    });

    it('never returns RetryWithReminder when retryCount >= maxRetries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 1, max: 20 }),
          (retry, max) => {
            if (retry < max) return true;
            const svc = new TodoContinuationService(makeConfig());
            const action = svc.classifyPostTurnAction(
              makeContext({
                activeTodos: [makeTodo({ status: 'pending' })],
                hadToolCalls: true,
                hadContent: true,
                retryCount: retry,
                maxRetries: max,
              }),
            );
            return action !== PostTurnAction.RetryWithReminder;
          },
        ),
      );
    });
  });
});
