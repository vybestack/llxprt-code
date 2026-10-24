/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

interface MaterializingJournal {
  materialize(): Promise<IContent[]>;
  streamRows(): AsyncIterable<IContent>;
}

function isMaterializingJournal(value: unknown): value is MaterializingJournal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'materialize') === 'function' &&
    typeof Reflect.get(value, 'streamRows') === 'function'
  );
}

function journalOf(history: object): MaterializingJournal {
  const journal: unknown = Reflect.get(history, 'journal');
  if (!isMaterializingJournal(journal)) {
    throw new Error('Materialization guard requires the service journal');
  }
  return journal;
}

export function forbidHistoryMaterializationForTest(
  history: { streamRawHistory(): AsyncIterable<IContent> },
  message = 'eager history materialization forbidden',
  forbidden: () => boolean = () => true,
): () => void {
  const journal = journalOf(history);
  const original = journal.materialize;
  journal.materialize = (): Promise<IContent[]> =>
    forbidden() ? Promise.reject(new Error(message)) : original.call(journal);
  return () => {
    journal.materialize = original;
  };
}

export function materializeHistoryForTest(
  history: object,
): Promise<IContent[]> {
  return journalOf(history).materialize();
}
