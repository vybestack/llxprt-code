/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #1542: saved task lists still borked.
 *
 * Root cause: TaskStore.writeTodos() persists an envelope object
 * { todos: [...], paused: boolean }, but the slash commands parsed the
 * file content as a bare Task[] array via JSON.parse. The parsed object
 * has no .filter() method, so countStatuses / buildStatusSummary threw
 * TypeError, the catch block fired, and every saved session showed
 * "(error reading file)".
 *
 * Fix: parseTodoFileContent() handles both the current envelope format and
 * the legacy bare-array format, returning Task[]. formatSessionEntry and
 * the load subcommand now use it instead of raw JSON.parse.
 */

import { describe, it, expect } from 'bun:test';
import { parseTodoFileContent } from './todoOperations.js';
import type { Todo } from '@vybestack/llxprt-code-core';

describe('parseTodoFileContent (issue #1542)', () => {
  describe('envelope format { todos, paused }', () => {
    it('extracts the todos array from an envelope with paused=false', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Task A', status: 'pending' },
        { id: '2', content: 'Task B', status: 'in_progress' },
      ];
      const content = JSON.stringify({ todos, paused: false });

      const result = parseTodoFileContent(content);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Task A');
      expect(result[1].status).toBe('in_progress');
    });

    it('extracts todos when paused=true', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Paused task', status: 'pending' },
      ];
      const content = JSON.stringify({ todos, paused: true });

      const result = parseTodoFileContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Paused task');
    });

    it('returns empty array when envelope has an empty todos array', () => {
      const content = JSON.stringify({ todos: [], paused: false });

      expect(parseTodoFileContent(content)).toStrictEqual([]);
    });
  });

  describe('legacy bare-array format', () => {
    it('parses a bare Task[] array', () => {
      const todos: Todo[] = [
        { id: '1', content: 'Legacy task', status: 'completed' },
      ];
      const content = JSON.stringify(todos);

      const result = parseTodoFileContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Legacy task');
      expect(result[0].status).toBe('completed');
    });

    it('returns empty array for an empty bare array', () => {
      expect(parseTodoFileContent('[]')).toStrictEqual([]);
    });
  });

  describe('invalid or unexpected content', () => {
    it('returns empty array when the envelope has no todos array', () => {
      const content = JSON.stringify({ paused: false });

      expect(parseTodoFileContent(content)).toStrictEqual([]);
    });

    it('returns empty array when the envelope todos field is not an array', () => {
      const content = JSON.stringify({ todos: 'not-an-array', paused: false });

      expect(parseTodoFileContent(content)).toStrictEqual([]);
    });

    it('returns empty array for a JSON object without a todos field', () => {
      const content = JSON.stringify({ foo: 'bar' });

      expect(parseTodoFileContent(content)).toStrictEqual([]);
    });

    it('returns empty array for a JSON primitive', () => {
      expect(parseTodoFileContent('42')).toStrictEqual([]);
      expect(parseTodoFileContent('"hello"')).toStrictEqual([]);
      expect(parseTodoFileContent('null')).toStrictEqual([]);
      expect(parseTodoFileContent('true')).toStrictEqual([]);
    });

    it('throws on invalid JSON', () => {
      expect(() => parseTodoFileContent('{ not json')).toThrow(SyntaxError);
      expect(() => parseTodoFileContent('')).toThrow(SyntaxError);
    });
  });

  describe('round-trip with TaskStore envelope', () => {
    it('parses output matching TaskStore.writeTodos format', () => {
      // TaskStore writes { todos, paused } — simulate that exact shape.
      const todos: Todo[] = [
        {
          id: 'user-1700000000000',
          content: 'Fix the bug',
          status: 'in_progress',
        },
        { id: 'user-1700000000001', content: 'Write tests', status: 'pending' },
      ];
      const diskContent = JSON.stringify({ todos, paused: false }, null, 2);

      const result = parseTodoFileContent(diskContent);

      expect(result).toStrictEqual(todos);
    });

    it('handles subtasks within the envelope', () => {
      const todos: Todo[] = [
        {
          id: '1',
          content: 'Parent',
          status: 'pending',
          subtasks: [
            { id: '1.1', content: 'Subtask one' },
            { id: '1.2', content: 'Subtask two' },
          ],
        },
      ];
      const content = JSON.stringify({ todos, paused: false });

      const result = parseTodoFileContent(content);

      expect(result).toHaveLength(1);
      expect(result[0].subtasks).toHaveLength(2);
      expect(result[0].subtasks?.[0].content).toBe('Subtask one');
    });
  });
});
