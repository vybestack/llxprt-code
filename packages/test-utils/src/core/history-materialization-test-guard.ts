/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

type Materializer = () => unknown;
type EagerReader = 'materializeSynchronously' | 'materialize';

function journalOf(history: object): object {
  const journal: unknown = Reflect.get(history, 'journal');
  if (typeof journal !== 'object' || journal === null) {
    throw new Error('Materialization guard requires the service journal');
  }
  return journal;
}

/**
 * The method that reads every row into memory at once: the old store's
 * same-turn sampler (which its `materialize()` calls), or the `materialize()`
 * of a store that reads rows from a file (it has `streamRows`; a stand-in with
 * only `materialize` is not a service journal).
 */
function eagerReader(journal: object): EagerReader {
  if (typeof Reflect.get(journal, 'materializeSynchronously') === 'function')
    return 'materializeSynchronously';
  if (
    typeof Reflect.get(journal, 'streamRows') === 'function' &&
    typeof Reflect.get(journal, 'materialize') === 'function'
  )
    return 'materialize';
  throw new Error('Materialization guard requires the service journal');
}

export function forbidHistoryMaterializationForTest(
  history: { streamRawHistory(): AsyncIterable<IContent> },
  message = 'eager history materialization forbidden',
  forbidden: () => boolean = () => true,
): () => void {
  const journal = journalOf(history);
  const name = eagerReader(journal);
  const original: Materializer = Reflect.get(journal, name);
  Reflect.set(journal, name, (): unknown => {
    if (!forbidden()) return original.call(journal);
    // The journal's `materialize()` is asynchronous, so its refusal is a rejection.
    if (name === 'materialize') return Promise.reject(new Error(message));
    throw new Error(message);
  });
  return () => {
    Reflect.set(journal, name, original);
  };
}
