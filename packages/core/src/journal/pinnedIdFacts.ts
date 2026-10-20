/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { IdFactQueries, type IdFactDeps } from './idFactQueries.js';
import type { PinnedRead } from './pinLease.js';

/** Id facts of one published version, read under a pin; close it when the queries are done. */
export class PinnedIdFacts extends IdFactQueries {
  constructor(
    source: ConstructorParameters<typeof IdFactQueries>[0],
    deps: IdFactDeps,
    private readonly read: PinnedRead,
  ) {
    super(source, deps);
  }

  close(): void | Promise<void> {
    return this.read.close();
  }
}
