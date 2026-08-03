/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  redactAssistantContent,
  buildTodoItems,
  NO_CONTENT,
} from './jspRedaction.js';

describe('redactAssistantContent', () => {
  it('returns bounded content for normal text', () => {
    const result = redactAssistantContent('Hello world', 16 * 1024);
    expect(result).toBe('Hello world');
  });

  it('truncates to the byte limit on the boundary', () => {
    const at = 'a'.repeat(16 * 1024);
    expect(redactAssistantContent(at, 16 * 1024)).toBe(at);
  });

  it('truncates over-limit content to the byte boundary', () => {
    const over = 'a'.repeat(16 * 1024 + 100);
    const result = redactAssistantContent(over, 16 * 1024);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(16 * 1024);
  });

  it('does not split a multibyte character', () => {
    const fill = 'a'.repeat(16 * 1024 - 1);
    const result = redactAssistantContent(fill + '𝕏', 16 * 1024);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(result.endsWith('a')).toBe(true);
  });

  it('never emits an unpaired surrogate at the truncation boundary', () => {
    // 'aaa' is 3 bytes and the astral character is 4, so a 6-byte budget can
    // hold a lone high surrogate's 3-byte replacement encoding but not the
    // real character. The boundary must fall before the pair, not inside it.
    const result = redactAssistantContent('aaa' + '𝕏', 6);
    expect(result).toBe('aaa');
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(6);
    expect([...result].every((ch) => ch.codePointAt(0) !== undefined)).toBe(
      true,
    );
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result)).toBe(false);
  });

  it('returns NO_CONTENT when noContent mode is set', () => {
    expect(redactAssistantContent('Hello world', 16 * 1024, true)).toBe(
      NO_CONTENT,
    );
  });
});

describe('buildTodoItems', () => {
  it('maps native todos to bounded {text,completed}', () => {
    const items = buildTodoItems(
      [
        { content: 'Write parser', status: 'completed' },
        { content: 'Add tests', status: 'in_progress' },
      ],
      { todoTextBytes: 2 * 1024, todoEntries: 256 },
    );
    expect(items).toStrictEqual([
      { text: 'Write parser', completed: true },
      { text: 'Add tests', completed: false },
    ]);
  });

  it('rejects an over-limit todo text by truncating to byte boundary', () => {
    const long = 'x'.repeat(2 * 1024 + 10);
    const items = buildTodoItems([{ content: long, status: 'pending' }], {
      todoTextBytes: 2 * 1024,
      todoEntries: 256,
    });
    expect(Buffer.byteLength(items[0].text, 'utf8')).toBeLessThanOrEqual(
      2 * 1024,
    );
  });

  it('caps the number of entries', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      content: `task ${i}`,
      status: 'pending',
    }));
    const items = buildTodoItems(many, {
      todoTextBytes: 2 * 1024,
      todoEntries: 256,
    });
    expect(items.length).toBe(256);
  });

  it('rejects a negative byte bound instead of returning empty content', () => {
    expect(() => redactAssistantContent('hello', -1)).toThrow(RangeError);
  });

  it('rejects a negative entry cap instead of slicing from the end', () => {
    const todos = [
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'completed' },
    ];
    expect(() =>
      buildTodoItems(todos, { todoTextBytes: 64, todoEntries: -1 }),
    ).toThrow(RangeError);
  });

  it('publishes an unrecognised native status as not completed', () => {
    const items = buildTodoItems([{ content: 'x', status: 'cancelled' }], {
      todoTextBytes: 64,
      todoEntries: 8,
    });
    expect(items).toStrictEqual([{ text: 'x', completed: false }]);
  });
});
