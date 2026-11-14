/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';

export interface Span {
  readonly offset: number;
  readonly size: number;
}

/** Spans, sorted by offset, tile `[0, total)` with no gap and no overlap. */
export function assertContiguous(
  layout: Readonly<Record<string, Span>>,
  total: number,
): void {
  const spans = Object.entries(layout).sort(
    ([, left], [, right]) => left.offset - right.offset,
  );
  let expected = 0;
  for (const [name, span] of spans) {
    expect({ name, offset: span.offset }).toEqual({ name, offset: expected });
    expected += span.size;
  }
  expect(expected).toBe(total);
}
