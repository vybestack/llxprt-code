/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { stableStringify } from '@vybestack/llxprt-code-core/services/history/token-usage-measurement.js';

export interface CallerLineageState {
  readonly count: number;
  readonly digest: string;
}

export class CallerRequestLineage {
  private readonly hash = createHash('sha256');
  private count = 0;
  private prefixMatches: boolean;

  constructor(private readonly previous: CallerLineageState | undefined) {
    this.prefixMatches = previous?.count === 0;
  }

  observe(row: IContent): void {
    const serialized = stableStringify(row);
    this.hash.update(`${serialized.length}:`);
    this.hash.update(serialized);
    this.count++;
    if (this.count === this.previous?.count)
      this.prefixMatches =
        this.hash.copy().digest('hex') === this.previous.digest;
  }

  continuesPrevious(): boolean {
    return this.prefixMatches;
  }

  finish(): CallerLineageState {
    return { count: this.count, digest: this.hash.digest('hex') };
  }
}
