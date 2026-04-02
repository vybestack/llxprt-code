/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for asyncIterator utilities
 * @issue #1750 - Stream retry boundary fix
 */

import { describe, it, expect } from 'vitest';
import { prependAsyncGenerator } from './asyncIterator.js';

describe('prependAsyncGenerator', () => {
  it('should prepend a value to a normal async iterator', async () => {
    async function* source(): AsyncGenerator<string> {
      yield 'second';
      yield 'third';
    }

    const prepended = prependAsyncGenerator('first', source());
    const results: string[] = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toStrictEqual(['first', 'second', 'third']);
  });

  it('should handle empty source iterator', async () => {
    // eslint-disable-next-line require-yield, sonarjs/generator-without-yield
    async function* emptySource(): AsyncGenerator<string> {
      // Generator returns immediately without yielding
      return;
    }

    const prepended = prependAsyncGenerator('only', emptySource());
    const results: string[] = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toStrictEqual(['only']);
  });

  it('should handle multiple values in source', async () => {
    async function* multiSource(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    }

    const prepended = prependAsyncGenerator(0, multiSource());
    const results: number[] = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toStrictEqual([0, 1, 2, 3, 4, 5]);
  });

  it('should handle complex objects', async () => {
    interface Chunk {
      id: number;
      text: string;
    }

    async function* chunkSource(): AsyncGenerator<Chunk> {
      yield { id: 2, text: 'world' };
      yield { id: 3, text: '!' };
    }

    const firstChunk: Chunk = { id: 1, text: 'hello' };
    const prepended = prependAsyncGenerator(firstChunk, chunkSource());
    const results: Chunk[] = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toStrictEqual({ id: 1, text: 'hello' });
    expect(results[1]).toStrictEqual({ id: 2, text: 'world' });
    expect(results[2]).toStrictEqual({ id: 3, text: '!' });
  });

  it('should propagate errors from source iterator', async () => {
    async function* errorSource(): AsyncGenerator<string> {
      yield 'first';
      throw new Error('Source error');
    }

    const prepended = prependAsyncGenerator('preloaded', errorSource());
    const results: string[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const value of prepended) {
        results.push(value);
      }
    } catch (error) {
      caughtError = error as Error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError?.message).toBe('Source error');
    // Should have received the preloaded value before the error
    expect(results).toStrictEqual(['preloaded', 'first']);
  });

  it('should allow manual iteration with .next()', async () => {
    async function* source(): AsyncGenerator<string> {
      yield 'b';
      yield 'c';
    }

    const prepended = prependAsyncGenerator('a', source());

    const result1 = await prepended.next();
    expect(result1.done).toBe(false);
    expect(result1.value).toBe('a');

    const result2 = await prepended.next();
    expect(result2.done).toBe(false);
    expect(result2.value).toBe('b');

    const result3 = await prepended.next();
    expect(result3.done).toBe(false);
    expect(result3.value).toBe('c');

    const result4 = await prepended.next();
    expect(result4.done).toBe(true);
  });

  it('should handle source that immediately returns', async () => {
    // eslint-disable-next-line require-yield, sonarjs/generator-without-yield
    async function* immediateSource(): AsyncGenerator<string> {
      return;
    }

    const prepended = prependAsyncGenerator('standalone', immediateSource());
    const results: string[] = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toStrictEqual(['standalone']);
  });

  it('should work with async iterators that yield undefined values', async () => {
    async function* undefinedSource(): AsyncGenerator<string | undefined> {
      yield undefined;
      yield 'value';
    }

    const prepended = prependAsyncGenerator('first', undefinedSource());
    const results: Array<string | undefined> = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toStrictEqual(['first', undefined, 'value']);
  });

  it('should handle return() being called early', async () => {
    let cleanedUp = false;
    async function* source(): AsyncGenerator<string> {
      try {
        yield 'a';
        yield 'b';
        yield 'c';
      } finally {
        cleanedUp = true;
      }
    }

    const prepended = prependAsyncGenerator('pre', source());

    const result1 = await prepended.next();
    expect(result1.value).toBe('pre');

    const result2 = await prepended.next();
    expect(result2.value).toBe('a');

    // Return early - should terminate the generator and trigger cleanup
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    await prepended.return?.();

    expect(cleanedUp).toBe(true);

    const result3 = await prepended.next();
    expect(result3.done).toBe(true);
  });

  it('should work with generator that has return value', async () => {
    // eslint-disable-next-line require-yield, sonarjs/generator-without-yield
    async function* source(): AsyncGenerator<string, string> {
      return 'return-value';
    }

    const prepended = prependAsyncGenerator('pre', source());
    const results: string[] = [];

    for await (const value of prepended) {
      results.push(value);
    }

    expect(results).toStrictEqual(['pre']);
  });
});
