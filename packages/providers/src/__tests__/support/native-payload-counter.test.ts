/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { NativePayloadCounter } from './native-payload-counter.js';

describe('native wire payload accounting', () => {
  for (const field of ['input', 'messages']) {
    it(`counts only the ${field} array across every byte split`, () => {
      const payload = JSON.stringify([
        { role: 'user', content: '雪 café "\\\n ] [{ ' },
        { arguments: { nested: ['[]'] } },
      ]);
      const wire = Buffer.from(
        `{"model":"test","${field}":${payload},"previous_response_id":"parent"}`,
      );
      for (let split = 0; split <= wire.byteLength; split++) {
        const counter = new NativePayloadCounter(
          field === 'input' ? 'input' : 'messages',
        );
        counter.append(wire.subarray(0, split));
        counter.append(wire.subarray(split));
        expect(counter.byteLength()).toBe(Buffer.byteLength(payload));
      }
    });
  }
  it('rejects a truncated payload rather than treating a partial count as valid', () => {
    const counter = new NativePayloadCounter('input');
    counter.append(Buffer.from('{"input":[{"text":"unfinished'));
    expect(() => counter.byteLength()).toThrow(
      'Missing complete native input payload',
    );
  });
});
