/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  asArray,
  asRecord,
  asRecordArray,
  asRecordMap,
  asNumberRecord,
  asStringArray,
  asVmFunction,
  stateComments,
  asExecError,
  errorField,
} from './typed-test-helpers.ts';

describe('typed test helper identity preservation', () => {
  it('returns validated records, arrays, and record maps without copying', () => {
    const record = { value: 1 };
    const array = [record];
    const recordMap = { record };

    expect(asRecord(record)).toBe(record);
    expect(asArray(array)).toBe(array);
    expect(asRecordArray(array)).toBe(array);
    expect(asRecordMap(recordMap)).toBe(recordMap);
  });

  it('returns validated string arrays and number records without copying', () => {
    const strings = ['one', 'two'];
    const numbers = { one: 1, two: 2 };
    expect(asStringArray(strings)).toBe(strings);
    expect(asNumberRecord(numbers)).toBe(numbers);
  });

  it('returns the original VM callable and preserves its receiver', () => {
    const callable = function (this: { value: number }): number {
      return this.value;
    };
    const receiver = { value: 42, callable: asVmFunction(callable) };

    expect(receiver.callable).toBe(callable);
    expect(receiver.callable()).toBe(42);
  });
});

describe('stateComments parses FakeComment records faithfully', () => {
  it('preserves extra fixture properties via spread', () => {
    const state = {
      comments: [
        {
          id: 1,
          issue_number: 42,
          body: 'hello',
          user: { login: 'bot', type: 'Bot' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          hiddenLists: 3,
        },
      ],
    };
    const comments = stateComments(state);
    expect(comments[0].hiddenLists).toBe(3);
  });

  it('treats issue_number, created_at, and updated_at as optional', () => {
    const state = {
      comments: [
        {
          id: 1,
          body: 'hello',
          user: { login: 'bot', type: 'Bot' },
        },
      ],
    };
    const comments = stateComments(state);
    expect(comments[0].id).toBe(1);
    expect(comments[0].issue_number).toBeUndefined();
    expect(comments[0].created_at).toBeUndefined();
    expect(comments[0].updated_at).toBeUndefined();
  });
});

describe('asExecError surfaces non-enumerable Error.message', () => {
  it('extracts message from a real Error instance', () => {
    const err: unknown = Object.assign(new Error('boom'), {
      stderr: 'err-out',
      status: 2,
      code: 'ENOENT',
    });
    const execErr = asExecError(err);
    expect(execErr.message).toBe('boom');
    expect(execErr.stderr).toBe('err-out');
    expect(execErr.status).toBe(2);
    expect(execErr.code).toBe('ENOENT');
  });

  it('errorField reads message from a real Error instance', () => {
    const err: unknown = Object.assign(new Error('crash'), {
      code: 'EACCES',
    });
    expect(errorField(err, 'message')).toBe('crash');
    expect(errorField(err, 'code')).toBe('EACCES');
  });
});
