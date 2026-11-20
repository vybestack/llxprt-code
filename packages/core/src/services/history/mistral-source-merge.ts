/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LabelSorter } from '../../journal/ordered-labels.js';

const CURSOR_LIMIT = 64;
interface Cursor {
  label: bigint;
  readonly reader: AsyncGenerator<bigint>;
}
type SourceReader = (rawId: string) => AsyncGenerator<bigint>;

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

class SourceCursors {
  readonly heap: Cursor[] = [];
  private readonly readers = new Set<AsyncGenerator<bigint>>();

  async admit(reader: AsyncGenerator<bigint>): Promise<Cursor | undefined> {
    this.readers.add(reader);
    const next = await reader.next();
    if (next.done !== true) return { label: next.value, reader };
    await this.retire(reader);
    return undefined;
  }

  private async retire(reader: AsyncGenerator<bigint>): Promise<void> {
    await reader.return(undefined);
    this.readers.delete(reader);
  }

  async advance(): Promise<void> {
    const cursor = this.heap[0];
    const next = await cursor.reader.next();
    if (next.done !== true) {
      cursor.label = next.value;
    } else {
      await this.retire(cursor.reader);
      const last = this.heap.pop();
      if (this.heap.length !== 0 && last !== undefined) this.heap[0] = last;
    }
    descend(this.heap, 0);
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.readers].map((reader) => reader.return(undefined)),
    );
  }
}

async function* remainingSources(
  heap: readonly Cursor[],
  overflow: Cursor,
  changed: AsyncGenerator<string>,
  sources: SourceReader,
): AsyncGenerator<bigint> {
  for (const cursor of heap) {
    yield cursor.label;
    yield* cursor.reader;
  }
  yield overflow.label;
  yield* overflow.reader;
  for await (const id of changed) yield* sources(id);
}

async function* orderedSources(cursors: SourceCursors): AsyncGenerator<bigint> {
  const heap = cursors.heap;
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index--)
    descend(heap, index);
  let previous: bigint | undefined;
  while (heap.length !== 0) {
    const cursor = heap[0];
    if (cursor.label !== previous) {
      previous = cursor.label;
      yield cursor.label;
    }
    await cursors.advance();
  }
}

export async function* mergeMistralSources(
  changed: AsyncGenerator<string>,
  sources: SourceReader,
  sortedLabels: LabelSorter,
): AsyncGenerator<bigint> {
  const cursors = new SourceCursors();
  try {
    for await (const rawId of changed) {
      const cursor = await cursors.admit(sources(rawId));
      if (cursor === undefined) continue;
      if (cursors.heap.length === CURSOR_LIMIT) {
        yield* sortedLabels(
          remainingSources(cursors.heap, cursor, changed, sources),
        );
        return;
      }
      cursors.heap.push(cursor);
    }
    yield* orderedSources(cursors);
  } finally {
    try {
      await cursors.close();
    } finally {
      await changed.return(undefined);
    }
  }
}
