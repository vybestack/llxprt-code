/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export interface RecordingFailureDetail {
  readonly generation: number;
  readonly path: string;
  readonly kind: string;
  readonly value?: string;
  readonly offset?: number;
}
interface Ancestor {
  readonly value: object;
  readonly path: string;
  readonly parent?: Ancestor;
}
function ancestorPath(value: object, parent?: Ancestor): string | undefined {
  for (let current = parent; current !== undefined; current = current.parent) {
    if (current.value === value) return current.path;
  }
  return undefined;
}
function* text(
  generation: number,
  path: string,
  kind: string,
  value: string,
): Generator<RecordingFailureDetail> {
  if (value.length === 0) yield { generation, path, kind, value, offset: 0 };
  for (let offset = 0; offset < value.length; offset += 2048) {
    yield {
      generation,
      path,
      kind,
      value: value.slice(offset, offset + 2048),
      offset,
    };
  }
}
function* property(
  generation: number,
  value: object,
  key: string,
  path: string,
  parent: Ancestor,
  depth: number,
): Generator<RecordingFailureDetail> {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return;
  const childPath = `${path}.${key.slice(0, 32)}`;
  yield* text(generation, childPath, 'property-name', key);
  if ('value' in descriptor) {
    yield* describeValue(
      generation,
      descriptor.value,
      childPath,
      parent,
      depth + 1,
    );
  } else {
    yield { generation, path: childPath, kind: 'accessor-not-evaluated' };
  }
}
function* describeValue(
  generation: number,
  value: unknown,
  path: string,
  parent?: Ancestor,
  depth = 0,
): Generator<RecordingFailureDetail> {
  if (typeof value === 'string') {
    yield* text(generation, path, 'string', value);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    yield* text(
      generation,
      path,
      value === null ? 'null' : typeof value,
      String(value),
    );
    return;
  }
  const cycle = ancestorPath(value, parent);
  if (cycle !== undefined) {
    yield { generation, path, kind: 'ancestor-reference', value: cycle };
    return;
  }
  if (depth === 32) {
    yield {
      generation,
      path,
      kind: 'diagnostic-depth-limit',
      value: '32; original identity only available from a live cause',
    };
    return;
  }
  yield* describeObject(generation, value, path, parent, depth);
}
function descriptorKind(value: object): string {
  if (value instanceof Error) return 'error-descriptor';
  if (Array.isArray(value)) return 'array-descriptor';
  return 'object-descriptor';
}
function* describeObject(
  generation: number,
  value: object,
  path: string,
  parent: Ancestor | undefined,
  depth: number,
): Generator<RecordingFailureDetail> {
  yield {
    generation,
    path,
    kind: descriptorKind(value),
    value:
      'diagnostic projection: identity, prototype, symbols and general non-enumerable properties are not reconstructed',
  };
  const ancestor: Ancestor = { value, path, parent };
  if (value instanceof Error) {
    yield* text(generation, path, 'error-name', value.name);
    for (const key of ['message', 'stack', 'cause', 'errors']) {
      yield* property(generation, value, key, path, ancestor, depth);
    }
  }
  for (const key in value) {
    if (
      value instanceof Error &&
      (key === 'message' || key === 'stack' || key === 'cause')
    )
      continue;
    yield* property(generation, value, key, path, ancestor, depth);
  }
  if (value instanceof Date)
    yield* text(generation, path, 'date', String(value));
  yield* describeEntries(generation, value, path, ancestor, depth);
  yield { generation, path, kind: 'end-descriptor' };
}
function isMap(value: object): value is Map<unknown, unknown> {
  return value instanceof Map;
}
function isSet(value: object): value is Set<unknown> {
  return value instanceof Set;
}
function* describeEntries(
  generation: number,
  value: object,
  path: string,
  parent: Ancestor,
  depth: number,
): Generator<RecordingFailureDetail> {
  let index = 0;
  if (isMap(value)) {
    for (const [key, entry] of value) {
      const entryPath = `${path}.entries[${index}]`;
      yield { generation, path: entryPath, kind: 'map-entry' };
      yield* describeValue(
        generation,
        key,
        `${entryPath}.key`,
        parent,
        depth + 1,
      );
      yield* describeValue(
        generation,
        entry,
        `${entryPath}.value`,
        parent,
        depth + 1,
      );
      index += 1;
    }
  } else if (isSet(value)) {
    for (const entry of value) {
      const entryPath = `${path}.values[${index}]`;
      yield { generation, path: entryPath, kind: 'set-entry' };
      yield* describeValue(generation, entry, entryPath, parent, depth + 1);
      index += 1;
    }
  }
}
export function* recordingFailureDetails(
  generation: number,
  value: unknown,
): Generator<RecordingFailureDetail> {
  yield {
    generation,
    path: '$',
    kind: 'failure',
    value: 'diagnostic descriptor; not the original rejection value',
  };
  try {
    yield* describeValue(generation, value, '$');
  } catch (error: unknown) {
    yield {
      generation,
      path: '$',
      kind: 'diagnostic-inspection-failed',
      value:
        error instanceof Error ? error.message.slice(0, 512) : typeof error,
    };
  }
}
