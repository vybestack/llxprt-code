/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LabelSorter } from '../../journal/ordered-labels.js';

const CURSOR_LIMIT = 64;
interface Cursor {
  label: bigint;
  readonly reader: AsyncGenerator<bigint>;
}

function descend(heap: Cursor[], start: number): void {
  let index = start;
  for (;;) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    const right = left + 1;
    const child =
      right < heap.length && heap[right].label < heap[left].label
        ? right
        : left;
    if (heap[index].label <= heap[child].label) return;
    [heap[index], heap[child]] = [heap[child], heap[index]];
    index = child;
  }
}

export async function* mergeMistralSources(
  changed: AsyncGenerator<string>,
  sources: (rawId: string) => AsyncGenerator<bigint>,
  sortedLabels: LabelSorter,
): AsyncGenerator<bigint> {
  const readers = new Set<AsyncGenerator<bigint>>();
  const heap: Cursor[] = [];
  try {
    for await (const rawId of changed) {
      const reader = sources(rawId);
      readers.add(reader);
      const next = await reader.next();
      if (next.done === true) {
        await reader.return(undefined);
        readers.delete(reader);
        continue;
      }
      if (heap.length === CURSOR_LIMIT) {
        async function* remaining(): AsyncGenerator<bigint> {
          for (const cursor of heap) {
            yield cursor.label;
            yield* cursor.reader;
          }
          yield next.value;
          yield* reader;
          for await (const id of changed) yield* sources(id);
        }
        yield* sortedLabels(remaining());
        return;
      }
      heap.push({ label: next.value, reader });
    }
    for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index--)
      descend(heap, index);
    let previous: bigint | undefined;
    while (heap.length !== 0) {
      const cursor = heap[0];
      if (cursor.label !== previous) {
        previous = cursor.label;
        yield cursor.label;
      }
      const next = await cursor.reader.next();
      if (next.done === true) {
        await cursor.reader.return(undefined);
        readers.delete(cursor.reader);
        const last = heap.pop();
        if (heap.length !== 0 && last !== undefined) heap[0] = last;
      } else cursor.label = next.value;
      descend(heap, 0);
    }
  } finally {
    try {
      await Promise.all([...readers].map((reader) => reader.return(undefined)));
    } finally {
      await changed.return(undefined);
    }
  }
}
