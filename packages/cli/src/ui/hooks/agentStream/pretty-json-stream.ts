/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class CheckpointHistoryArray {
  constructor(readonly rows: AsyncIterable<unknown>) {}
}

function normalized(value: unknown, key: string): unknown {
  if (typeof value === 'object' && value !== null) {
    const toJSON: unknown = Reflect.get(value, 'toJSON');
    if (typeof toJSON === 'function')
      return Reflect.apply(toJSON, value, [key]);
    if (
      value instanceof Number ||
      value instanceof String ||
      value instanceof Boolean ||
      value instanceof BigInt
    )
      return value.valueOf();
  }
  return value;
}

function omitted(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}

function* quoted(value: string): Generator<string, void, unknown> {
  yield '"';
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + 2048, value.length);
    const last = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

async function* arrayParts(
  rows: Iterable<unknown> | AsyncIterable<unknown>,
  depth: number,
  ancestors: Set<object>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield '[';
  let count = 0;
  for await (const row of rows) {
    signal?.throwIfAborted();
    yield (count === 0 ? '\n' : ',\n') + '  '.repeat(depth + 1);
    const value = normalized(row, String(count++));
    yield* jsonParts(
      omitted(value) ? null : value,
      depth + 1,
      ancestors,
      signal,
    );
  }
  if (count > 0) yield '\n' + '  '.repeat(depth);
  yield ']';
}

async function* objectParts(
  value: object,
  depth: number,
  ancestors: Set<object>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield '{';
  let count = 0;
  for (const key of Object.keys(value)) {
    const item = normalized(Reflect.get(value, key), key);
    if (omitted(item)) continue;
    yield (count++ === 0 ? '\n' : ',\n') + '  '.repeat(depth + 1);
    yield* quoted(key);
    yield ': ';
    yield* jsonParts(item, depth + 1, ancestors, signal);
  }
  if (count > 0) yield '\n' + '  '.repeat(depth);
  yield '}';
}

async function* jsonParts(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  signal?.throwIfAborted();
  if (typeof value === 'string') {
    yield* quoted(value);
  } else if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value))
      throw new TypeError('Converting circular structure to JSON');
    ancestors.add(value);
    try {
      if (value instanceof CheckpointHistoryArray)
        yield* arrayParts(value.rows, depth, ancestors, signal);
      else if (Array.isArray(value))
        yield* arrayParts(value, depth, ancestors, signal);
      else yield* objectParts(value, depth, ancestors, signal);
    } finally {
      ancestors.delete(value);
    }
  } else {
    if (omitted(value))
      throw new TypeError('Checkpoint value is not serializable');
    yield JSON.stringify(value);
  }
}

export async function* streamPrettyCheckpointJson(
  value: object,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  let chunk = '';
  for await (const part of jsonParts(
    normalized(value, ''),
    0,
    new Set(),
    signal,
  )) {
    signal?.throwIfAborted();
    if (chunk.length + part.length > 16 * 1024) {
      yield chunk;
      chunk = '';
    }
    chunk += part;
  }
  signal?.throwIfAborted();
  if (chunk.length > 0) yield chunk;
}
