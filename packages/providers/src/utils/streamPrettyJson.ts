/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { StreamJsonString, quotedChunks } from './streamJsonString.js';
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  );
}
function jsonValue(value: unknown, key: string): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toJSON' in value &&
    typeof value.toJSON === 'function'
  )
    value = value.toJSON(key);
  if (
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean
  )
    return value.valueOf();
  return value;
}
function omitted(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}
async function* arrayJson(
  values: AsyncIterable<unknown> | Iterable<unknown>,
  depth: number,
  ancestors: WeakSet<object>,
): AsyncGenerator<string> {
  yield '[';
  let index = 0;
  for await (const original of values) {
    const value = jsonValue(original, String(index));
    yield `${index === 0 ? '\n' : ',\n'}${'  '.repeat(depth + 1)}`;
    index++;
    yield* emitJson(omitted(value) ? null : value, depth + 1, ancestors);
  }
  yield index === 0 ? ']' : `\n${'  '.repeat(depth)}]`;
}
async function* objectJson(
  value: object,
  depth: number,
  ancestors: WeakSet<object>,
): AsyncGenerator<string> {
  yield '{';
  let first = true;
  for (const [key, original] of Object.entries(value)) {
    const child = jsonValue(original, key);
    if (omitted(child)) continue;
    yield `${first ? '\n' : ',\n'}${'  '.repeat(depth + 1)}${JSON.stringify(key)}: `;
    first = false;
    yield* emitJson(child, depth + 1, ancestors);
  }
  yield first ? '}' : `\n${'  '.repeat(depth)}}`;
}
async function* emitJson(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): AsyncGenerator<string> {
  if (value instanceof StreamJsonString) {
    yield* quotedChunks(value);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    yield JSON.stringify(value);
    return;
  }
  if (ancestors.has(value))
    throw new TypeError('Converting circular structure to JSON');
  ancestors.add(value);
  try {
    if (isAsyncIterable(value) || Array.isArray(value))
      yield* arrayJson(value, depth, ancestors);
    else yield* objectJson(value, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}
export async function* streamPrettyJson(
  value: unknown,
  depth = 0,
): AsyncGenerator<string> {
  yield* emitJson(jsonValue(value, ''), depth, new WeakSet());
}
