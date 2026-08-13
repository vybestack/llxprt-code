/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { formatTodoListForDisplay } from '../todoFormatter.js';
import type { Todo, TodoToolCall } from '../../types/todo-schemas.js';

function makeToolCall(
  overrides: Partial<TodoToolCall> & { name: string },
): TodoToolCall {
  return {
    id: overrides.id ?? `call-${overrides.name}`,
    name: overrides.name,
    parameters: overrides.parameters ?? {},
    timestamp: overrides.timestamp ?? new Date('2025-01-01T00:00:00Z'),
  };
}

function makeTodo(overrides: Partial<Todo> & { content: string }): Todo {
  return {
    id: 'todo-1',
    status: 'in_progress',
    ...overrides,
  };
}

describe('formatTodoListForDisplay (tools)', () => {
  describe('persisted todo.toolCalls rendering', () => {
    it('renders two distinct persisted tool calls as ↳ name(params) lines in order', () => {
      const todo = makeTodo({
        content: 'Fix the bug',
        toolCalls: [
          makeToolCall({
            id: 'c1',
            name: 'read_file',
            parameters: { path: 'src/app.ts' },
          }),
          makeToolCall({
            id: 'c2',
            name: 'write_file',
            parameters: { file_path: 'src/app.ts', content: 'hello' },
          }),
        ],
      });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain("  ↳ read_file(path: 'src/app.ts')");
      expect(result).toContain(
        "  ↳ write_file(file_path: 'src/app.ts', content: 'hello')",
      );
      const readIdx = result.indexOf('read_file');
      const writeIdx = result.indexOf('write_file');
      expect(readIdx).toBeLessThan(writeIdx);
    });

    it('renders two consecutive identical calls as one line with the 2x suffix', () => {
      const todo = makeTodo({
        content: 'Read twice',
        toolCalls: [
          makeToolCall({
            id: 'c1',
            name: 'read_file',
            parameters: { path: 'a.ts' },
          }),
          makeToolCall({
            id: 'c2',
            name: 'read_file',
            parameters: { path: 'a.ts' },
          }),
        ],
      });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain("  ↳ read_file(path: 'a.ts') 2x");
      expect(result.match(/read_file/g)).toHaveLength(1);
    });

    it('renders the overflow line and last five when seven distinct calls exist', () => {
      const toolCalls: TodoToolCall[] = [];
      for (let i = 1; i <= 7; i++) {
        toolCalls.push(
          makeToolCall({
            id: `c${i}`,
            name: `tool_${i}`,
            parameters: { n: i },
          }),
        );
      }
      const todo = makeTodo({ content: 'Many calls', toolCalls });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain('  ↳ ...2 more tool calls...');
      const renderedCalls = result
        .split('\n')
        .filter((line) => /^ {2}↳ tool_\d+\(n: \d+\)$/.test(line));
      expect(renderedCalls).toEqual([
        '  ↳ tool_3(n: 3)',
        '  ↳ tool_4(n: 4)',
        '  ↳ tool_5(n: 5)',
        '  ↳ tool_6(n: 6)',
        '  ↳ tool_7(n: 7)',
      ]);
      expect(result).not.toContain('tool_1(n: 1)');
      expect(result).not.toContain('tool_2(n: 2)');
    });

    it('renders the todo line and no ↳ line when toolCalls is undefined', () => {
      const todo = makeTodo({ content: 'No tool calls', toolCalls: undefined });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain('No tool calls');
      expect(result).not.toContain('↳');
    });
  });

  describe('persisted subtask.toolCalls rendering', () => {
    it('renders subtask tool calls at the four-space indent beneath the subtask', () => {
      const todo = makeTodo({
        content: 'Main task',
        subtasks: [
          {
            id: 'sub-1',
            content: 'Read a file',
            toolCalls: [
              makeToolCall({
                id: 'sc1',
                name: 'read_file',
                parameters: { path: 'config.json' },
              }),
            ],
          },
        ],
      });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain('  • Read a file');
      expect(result).toContain("    ↳ read_file(path: 'config.json')");
    });
  });

  describe('path truncation', () => {
    it('truncates a file_path longer than 40 chars with leading-ellipsis form', () => {
      const longPath = 'src/very/deeply/nested/directory/structure/app.ts';
      const todo = makeTodo({
        content: 'Long path',
        toolCalls: [
          makeToolCall({
            id: 'c1',
            name: 'read_file',
            parameters: { file_path: longPath },
          }),
        ],
      });

      const result = formatTodoListForDisplay([todo]);

      const expectedTail = longPath.slice(-37);
      expect(result).toContain(`file_path: '...${expectedTail}'`);
      expect(result).not.toContain(longPath);
    });
  });

  describe('status and summary lines', () => {
    it('renders the header, summary, and the tools-specific in_progress suffix', () => {
      const todo = makeTodo({
        content: 'Active task',
        status: 'in_progress',
      });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain('## Todo Progress');
      expect(result).toContain(
        '1 tasks: 0 completed, 1 in progress, 0 pending',
      );
      expect(result).toContain('→ Active task (in_progress) ← current');
    });

    it('renders pending todos with the ○ marker and no in_progress suffix', () => {
      const todo = makeTodo({
        content: 'Waiting task',
        status: 'pending',
      });

      const result = formatTodoListForDisplay([todo]);

      expect(result).toContain('○ Waiting task');
      expect(result).not.toContain('(in_progress)');
      expect(result).not.toContain('← current');
    });
  });
});
