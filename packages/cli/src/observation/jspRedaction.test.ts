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
import { JSP_BOUNDS } from './jspBounds.js';

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
  const BOUNDS = {
    todoTextBytes: JSP_BOUNDS.todoTextBytes,
    todoEntries: JSP_BOUNDS.todoEntries,
    todoStateBytes: JSP_BOUNDS.todoStateBytes,
  };

  it('maps native todos to bounded {text,state}', () => {
    const items = buildTodoItems(
      [
        { content: 'Write parser', status: 'completed' },
        { content: 'Add tests', status: 'in_progress' },
        { content: 'Ship it', status: 'pending' },
      ],
      BOUNDS,
    );
    expect(items).toStrictEqual([
      { text: 'Write parser', state: 'completed' },
      { text: 'Add tests', state: 'in_progress' },
      { text: 'Ship it', state: 'pending' },
    ]);
  });

  it('publishes only text and state, never the retired completed flag', () => {
    // The consumer schema is closed, so a residual member is rejected outright
    // rather than ignored. Assert on the item's own keys so a leftover cannot
    // slip past a partial match.
    const items = buildTodoItems(
      [{ content: 'Write parser', status: 'completed' }],
      BOUNDS,
    );
    expect(Object.keys(items[0]).sort()).toStrictEqual(['state', 'text']);
  });

  it('rejects an over-limit todo text by truncating to byte boundary', () => {
    const long = 'x'.repeat(2 * 1024 + 10);
    const items = buildTodoItems(
      [{ content: long, status: 'pending' }],
      BOUNDS,
    );
    expect(Buffer.byteLength(items[0].text, 'utf8')).toBeLessThanOrEqual(
      2 * 1024,
    );
  });

  it('caps the number of entries', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      content: `task ${i}`,
      status: 'pending',
    }));
    const items = buildTodoItems(many, BOUNDS);
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
      buildTodoItems(todos, {
        todoTextBytes: 64,
        todoEntries: -1,
        todoStateBytes: 64,
      }),
    ).toThrow(RangeError);
  });

  it('publishes an unrecognised native status verbatim', () => {
    // The vocabulary is open on purpose: the consumer reads an unrecognised
    // label as neither completed nor active. Coercing it onto a recognised
    // value here would reintroduce the guess this field exists to remove.
    const items = buildTodoItems([{ content: 'x', status: 'cancelled' }], {
      ...BOUNDS,
      todoEntries: 8,
    });
    expect(items).toStrictEqual([{ text: 'x', state: 'cancelled' }]);
  });

  it('publishes an empty state verbatim rather than substituting one', () => {
    const items = buildTodoItems([{ content: 'x', status: '' }], BOUNDS);
    expect(items).toStrictEqual([{ text: 'x', state: '' }]);
  });

  it('publishes a state of exactly the byte bound unchanged', () => {
    const at = 's'.repeat(JSP_BOUNDS.todoStateBytes);
    expect(Buffer.byteLength(at, 'utf8')).toBe(JSP_BOUNDS.todoStateBytes);
    const items = buildTodoItems([{ content: 'x', status: at }], BOUNDS);
    expect(items[0].state).toBe(at);
  });

  it('rejects an over-bound state rather than publishing a truncated label', () => {
    // A status is an opaque label the consumer compares for equality, so a
    // truncated one is a value the source never reported. Publishing it would
    // put a producer invention into the field that exists to stop the producer
    // guessing, so the projection fails instead.
    const over = 's'.repeat(JSP_BOUNDS.todoStateBytes + 1);
    expect(() =>
      buildTodoItems([{ content: 'x', status: over }], BOUNDS),
    ).toThrow(/todo state exceeds/);
  });

  it('measures the state bound in UTF-8 bytes, not UTF-16 code units', () => {
    // Sixteen astral characters are 32 code units but 64 bytes, so a code-unit
    // check would accept a status that doubles the published bound.
    const atBytes = '𝕏'.repeat(JSP_BOUNDS.todoStateBytes / 4);
    expect(Buffer.byteLength(atBytes, 'utf8')).toBe(JSP_BOUNDS.todoStateBytes);
    expect(
      buildTodoItems([{ content: 'x', status: atBytes }], BOUNDS),
    ).toStrictEqual([{ text: 'x', state: atBytes }]);
    expect(() =>
      buildTodoItems([{ content: 'x', status: atBytes + 'a' }], BOUNDS),
    ).toThrow(RangeError);
  });

  it('rejects a negative state bound instead of rejecting every status', () => {
    expect(() =>
      buildTodoItems([{ content: 'x', status: 'pending' }], {
        ...BOUNDS,
        todoStateBytes: -1,
      }),
    ).toThrow(RangeError);
  });
});
