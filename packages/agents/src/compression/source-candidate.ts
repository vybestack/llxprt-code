/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Raw pending input a pending-aware candidate is recomposed from. */
export interface SourcePendingRows {
  read(): Promise<IContent[]>;
  replace(rows: IContent[]): void;
}

/** One pinned candidate and its scalar estimate, invalidated by history or pending edits. */
export class SourceCandidate<S> {
  private current: S;
  private unchanged: (() => boolean) | undefined;
  private pendingChanged = false;
  private measured: Promise<number> | undefined;
  readonly pending: SourcePendingRows;

  constructor(
    initial: S,
    private readonly estimateCandidate: (candidate: S) => Promise<number>,
    private readonly reopenCandidate: () => Promise<S>,
    pending: SourcePendingRows,
    private readonly captureHistoryGuard?: () => () => boolean,
  ) {
    this.current = initial;
    this.unchanged = captureHistoryGuard?.();
    this.pending = {
      read: () => pending.read(),
      replace: (rows) => {
        pending.replace(rows);
        this.pendingChanged = true;
      },
    };
  }

  get value(): S {
    return this.current;
  }

  estimate(): Promise<number> {
    if (this.captureHistoryGuard === undefined)
      return this.estimateCandidate(this.current);
    this.measured ??= this.estimateCandidate(this.current);
    return this.measured;
  }

  async replace(): Promise<void> {
    if (!this.pendingChanged && this.unchanged?.() === true) return;
    this.current = await this.reopenCandidate();
    this.unchanged = this.captureHistoryGuard?.();
    this.pendingChanged = false;
    this.measured = undefined;
  }

  async replacePending(rows: IContent[]): Promise<void> {
    const previous = await this.pending.read();
    if (
      previous.length !== rows.length ||
      previous.some((row, index) => row !== rows[index])
    )
      this.pending.replace(rows);
  }

  /** Request tokens of the candidate rebuilt with `rows` as its pending input. */
  async estimateWithPending(rows: IContent[]): Promise<number> {
    await this.replacePending(rows);
    await this.replace();
    return this.estimate();
  }
}
