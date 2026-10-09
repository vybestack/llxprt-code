/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SemanticMediaPurgeBoundaryIdentity } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import { createSafeJsonReplacer } from './turnJsonUtils.js';

type Replacer = ReturnType<typeof createSafeJsonReplacer>;

function prepare(value: unknown, key: string, replacer: Replacer): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toJSON' in value &&
    typeof value.toJSON === 'function'
  )
    value = value.toJSON(key);
  return replacer(key, value);
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
  for (let start = 0; start < value.length; ) {
    let end = Math.min(start + 4096, value.length);
    const last = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}
function* emit(
  value: unknown,
  replacer: Replacer,
): Generator<string, void, unknown> {
  if (typeof value === 'string') {
    yield* quoted(value);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    yield JSON.stringify(value);
    return;
  }
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) {
      if (index > 0) yield ',';
      const child = prepare(value[index], String(index), replacer);
      yield* emit(omitted(child) ? null : child, replacer);
    }
    yield ']';
    return;
  }
  yield '{';
  let first = true;
  for (const key of Object.keys(value)) {
    const child = prepare(Reflect.get(value, key), key, replacer);
    if (omitted(child)) continue;
    if (!first) yield ',';
    first = false;
    yield* quoted(key);
    yield ':';
    yield* emit(child, replacer);
  }
  yield '}';
}

export class TurnRequestBoundaryIdentity {
  private identity: object | undefined;
  private encountered = false;

  row(row: IContent, index: number): Generator<string, void, unknown> {
    const id = row.metadata?.semanticMediaPurgeBoundary?.boundaryId;
    if (id !== undefined) {
      const prototype: unknown = Object.getPrototypeOf(id);
      if (
        (prototype !== Object.prototype &&
          prototype !== SemanticMediaPurgeBoundaryIdentity.prototype) ||
        !Object.isFrozen(id) ||
        Reflect.ownKeys(id).length !== 0
      )
        throw new Error('Unsupported semantic purge boundary identity graph');
      if (this.identity !== undefined && this.identity !== id)
        throw new Error(
          'Unsupported conflicting semantic purge boundary identities',
        );
      this.identity = id;
    }
    const safe = createSafeJsonReplacer();
    const replacer: Replacer = (key, value) => {
      if (value === this.identity && value !== undefined) {
        if (this.encountered) return '[Circular]';
        this.encountered = true;
      }
      return safe(key, value);
    };
    const value = prepare(row, String(index), replacer);
    if (omitted(value))
      throw new Error('Turn request row did not serialize to JSON');
    return emit(value, replacer);
  }
}
