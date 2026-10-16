/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { streamPrettyJson } from './streamPrettyJson.js';
import { StreamJsonString } from './streamJsonString.js';
async function collect(value: unknown): Promise<string> {
  let text = '';
  for await (const chunk of streamPrettyJson(value)) text += chunk;
  return text;
}
describe('streamed JSON legacy formatting', () => {
  it('preserves escaping when streamed strings split a surrogate pair across empty chunks', async () => {
    const chunks = ['a"\n\\', '\ud83d', '', '\ude00', '\ud800', 'z'];
    const streamed = new StreamJsonString(
      async function* (): AsyncIterable<string> {
        yield* chunks;
      },
    );
    expect(await collect({ text: streamed })).toBe(
      JSON.stringify({ text: chunks.join('') }, null, 2),
    );
  });
  it('matches JSON.stringify for dates, toJSON, omitted fields and array holes', async () => {
    const value = {
      date: new Date('2026-09-29T00:00:00Z'),
      custom: {
        toJSON: (key: string): unknown => ({ parentKey: key, text: '雪\n"' }),
      },
      array: [
        undefined,
        Symbol('omitted'),
        (): void => {},
        NaN,
        Infinity,
        null,
      ],
      omitted: undefined,
      function: (): void => {},
      number: new Number(3),
      string: new String('test'),
      boolean: new Boolean(false),
    };
    expect(await collect(value)).toBe(JSON.stringify(value, null, 2));
  });
  it('rejects cycles instead of writing an unbounded recursive stream', async () => {
    const value: { child?: unknown } = {};
    value.child = value;
    await expect(collect(value)).rejects.toThrow(/circular/i);
  });
});
