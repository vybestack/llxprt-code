/**
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TodoWrite params boundary validation (issue #3655)
 *
 * Malformed `todo_write` arguments from the model (missing `todos`, null or
 * non-array `todos`, non-object args) must be rejected at the build boundary
 * so no invocation wrapping them is ever created. The Ink UI crash
 * (`undefined is not an object (evaluating 'params.todos.length')` from
 * `getDescription`) is eliminated because a malformed build throws instead of
 * producing an invocation whose description evaluates `params.todos.length`.
 *
 * Real TodoWrite tool with a fake ITodoService infrastructure stub (same
 * pattern as todo-tools.test.ts). No mock theater.
 */

import { describe, expect, it } from 'bun:test';
import { TodoWriteTool } from '../index.js';
import type { ITodoService, TodoStore } from '../interfaces/index.js';
import type { Todo } from '../types/todo-schemas.js';
import type { TodoWriteParams } from '../tools/todo-write.js';

function createFakeTodoService(initialTodos: Todo[] = []): ITodoService {
  let todos = [...initialTodos];

  const store: TodoStore = {
    getTodos: () => todos,
    setTodos: (newTodos: Todo[]) => {
      todos = [...newTodos];
    },
  };

  return {
    getTodoStore: () => store,
    getReminderService: () => ({
      shouldGenerateReminder: () => todos.length > 0,
      getReminderForStateChange: () => 'reminder text',
    }),
    getContextTracker: () => ({
      setActiveTodo: (id: string | null) => {
        void id;
      },
      clearActiveTodo: () => {},
    }),
    getDefaultAgentId: () => 'test-agent',
  };
}

function createTool(): TodoWriteTool {
  return new TodoWriteTool(createFakeTodoService());
}

// Raw, unchecked model arguments arrive at the build boundary typed as the
// tool's param type even when their runtime shape is invalid. This helper
// makes that narrowing explicit where the literal itself is untypeable as
// TodoWriteParams.
function asModelParams(value: unknown): TodoWriteParams {
  return value as TodoWriteParams;
}

// Untrusted model output: these inputs are structurally invalid and are
// kept as `unknown`, cast through to the param type in the test exactly as
// raw, unchecked model arguments arrive at the build boundary.
const malformedCases: Array<[string, unknown]> = [
  ['undefined args', undefined],
  ['null args', null],
  ['string args', 'x'],
  ['number args', 0],
  ['boolean args', false],
  ['array args', []],
  ['empty object args', {}],
  ['undefined todos', { todos: undefined }],
  ['null todos', { todos: null }],
  ['string todos', { todos: 'x' }],
  ['object todos', { todos: {} }],
  ['null todo item', { todos: [null] }],
  ['undefined todo item', { todos: [undefined] }],
  ['number todo item', { todos: [42] }],
  ['string todo item', { todos: ['str'] }],
];

describe('TodoWrite rejects malformed params at the build boundary (issue #3655)', () => {
  it.each(malformedCases)(
    'rejects %s with an error mentioning todos and a throwing build',
    (_label, input) => {
      const tool = createTool();
      const rawParams = asModelParams(input);

      const error = tool.validateToolParams(rawParams);
      expect(typeof error).toBe('string');
      expect(error).toContain('todos');

      expect(() => tool.build(rawParams)).toThrow('todos');
    },
  );
});

describe('TodoWrite accepts valid params', () => {
  it.each([
    ['an empty list (legal clear operation)', { todos: [] }],
    [
      'a single full item',
      { todos: [{ id: '1', content: 'a', status: 'pending' }] },
    ],
    [
      'an item with optional fields omitted',
      { todos: [{ id: 2, content: 'b', status: 'in_progress' }] },
    ],
  ])('accepts %s', (_label, params) => {
    const tool = createTool();
    expect(tool.validateToolParams(params)).toBeNull();
  });
});

describe('TodoWrite invocation description for valid params', () => {
  it('returns the item-count description for a built invocation', () => {
    const tool = createTool();
    const params: TodoWriteParams = {
      todos: [{ id: '1', content: 'a', status: 'pending' }],
    };

    expect(tool.build(params).getDescription()).toBe(
      'Update todo list with 1 items',
    );
  });

  it('returns a zero-item description for the empty list', () => {
    const tool = createTool();
    const params: TodoWriteParams = { todos: [] };

    expect(tool.build(params).getDescription()).toBe(
      'Update todo list with 0 items',
    );
  });
});
