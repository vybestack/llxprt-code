/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Raw pending input a pending-aware candidate is recomposed from. */
export interface SourcePendingRows {
  read(): Promise<IContent[]>;
  replace(rows: IContent[]): void;
}

/**
 * The current disk candidate for one enforcement. `estimate` measures a
 * candidate, `reopen` rebuilds the pending-aware candidate from the durable
 * journal and the current pending rows. Superseded candidates stay owned by
 * the send preparer, which closes everything but the kept one.
 */
export class SourceCandidate<S> {
  private current: S;

  constructor(
    initial: S,
    private readonly estimateCandidate: (candidate: S) => Promise<number>,
    private readonly reopenCandidate: () => Promise<S>,
    readonly pending: SourcePendingRows,
  ) {
    this.current = initial;
  }

  get value(): S {
    return this.current;
  }

  estimate(): Promise<number> {
    return this.estimateCandidate(this.current);
  }

  async replace(): Promise<void> {
    this.current = await this.reopenCandidate();
  }

  /** Request tokens of the candidate rebuilt with `rows` as its pending input. */
  async estimateWithPending(rows: IContent[]): Promise<number> {
    this.pending.replace(rows);
    await this.replace();
    return this.estimate();
  }
}
