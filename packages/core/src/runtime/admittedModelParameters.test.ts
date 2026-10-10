/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ownModelParameters } from './admittedModelParameters.js';

describe('admitted wire parameters', () => {
  it('owns nested arrays and records without freezing caller values', () => {
    const input = {
      stop: ['old'],
      response_format: { schema: { title: 'First' } },
    };
    const captured = ownModelParameters(input);
    input.stop.push('new');
    input.response_format.schema.title = 'Second';
    expect(captured).toStrictEqual({
      stop: ['old'],
      response_format: { schema: { title: 'First' } },
    });
    expect(Object.isFrozen(input.stop)).toBe(false);
    expect(Object.isFrozen(captured.stop)).toBe(true);
    expect(Object.isFrozen(captured.response_format)).toBe(true);
  });

  it.each([
    [
      { response_format: { schema: { invalid: undefined } } },
      'modelParams.response_format.schema.invalid',
    ],
    [{ stop: Array(3) }, 'modelParams.stop[0]'],
    [{ temperature: Number.POSITIVE_INFINITY }, 'modelParams.temperature'],
    [{ stop: [new Date()] }, 'modelParams.stop[0]'],
    [{ stop: [() => 1] }, 'modelParams.stop[0]'],
  ])('rejects invalid data at its path: %s', (input, path) => {
    expect(() => ownModelParameters(input)).toThrow(path);
  });

  it('rejects cycles and accessors without evaluating them', () => {
    const cycle: Record<string, unknown> = {};
    cycle['child'] = cycle;
    expect(() => ownModelParameters({ cycle })).toThrow(
      'modelParams.cycle.child',
    );
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('evaluated');
      },
    });
    expect(() => ownModelParameters({ accessor })).toThrow(
      'modelParams.accessor.secret',
    );
  });

  it('keeps empty maps authoritative and rejects dangerous keys', () => {
    expect(ownModelParameters({})).toStrictEqual({});
    const dangerous = Object.defineProperty({}, '__proto__', {
      value: 'bad',
      enumerable: true,
    });
    expect(() => ownModelParameters(dangerous)).toThrow(
      'modelParams.__proto__',
    );
  });
});
