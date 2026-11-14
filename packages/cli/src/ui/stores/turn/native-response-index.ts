/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeJournalPageReader } from '@vybestack/llxprt-code-core';

export class NativeResponseIndex {
  constructor(private readonly reader: NativeJournalPageReader) {}

  last(id: string, from: bigint, end: bigint): Promise<bigint | undefined> {
    return this.reader.lastResponseLabel(id, from, end);
  }
}
