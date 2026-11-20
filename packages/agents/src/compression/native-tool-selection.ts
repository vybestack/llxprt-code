/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  rankBefore,
  type ToolRank,
} from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';

export function selectedToolRank(
  rank: ToolRank,
  previous: ToolRank | undefined,
  last: ToolRank,
): boolean {
  return (
    !rankBefore(last, rank) &&
    (previous === undefined || rankBefore(previous, rank))
  );
}

export class NativeToolSelection {
  private history: IteratorResult<ToolRank, void> = {
    done: true,
    value: undefined,
  };
  private pending: IteratorResult<ToolRank, void> = {
    done: true,
    value: undefined,
  };
  constructor(
    private readonly historyCursor: AsyncGenerator<ToolRank>,
    private readonly pendingCursor: AsyncGenerator<ToolRank>,
    private readonly rows: number,
  ) {}

  async run<T>(action: () => Promise<T>): Promise<T> {
    let outcome: { readonly result: T } | { readonly failure: unknown };
    try {
      await this.start();
      outcome = { result: await action() };
    } catch (error) {
      outcome = { failure: error };
    }
    const cleanup: unknown[] = [];
    try {
      await this.close();
    } catch (error) {
      cleanup.push(error);
    }
    if ('failure' in outcome) {
      if (cleanup.length > 0)
        throw new AggregateError(
          [outcome.failure, ...cleanup],
          'Tool ranking selection failed',
          { cause: outcome.failure },
        );
      throw outcome.failure;
    }
    if (cleanup.length > 0) throw cleanup[0];
    return outcome.result;
  }
  async start(): Promise<void> {
    this.history = await this.historyCursor.next();
    this.pending = await this.pendingCursor.next();
  }
  async take(): Promise<ToolRank | undefined> {
    if (
      this.history.done !== true &&
      (this.pending.done === true ||
        rankBefore(this.history.value, this.pending.value))
    ) {
      const rank = this.history.value;
      this.history = await this.historyCursor.next();
      return rank;
    }
    if (this.pending.done === true) return undefined;
    const rank = this.pending.value;
    this.pending = await this.pendingCursor.next();
    return rank;
  }
  async round(
    projected: number,
    limit: number,
    scale: number,
  ): Promise<
    | {
        readonly last: ToolRank;
        readonly saving: number;
        readonly firstHistory: number;
      }
    | undefined
  > {
    let saving = 0;
    let firstHistory = Infinity;
    for (
      let rank = await this.take();
      rank !== undefined;
      rank = await this.take()
    ) {
      saving += rank.saving;
      if (rank.ordinal < this.rows)
        firstHistory = Math.min(firstHistory, rank.ordinal);
      if (projected - saving * scale <= limit)
        return { last: rank, saving, firstHistory };
    }
    return undefined;
  }
  async close(): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.historyCursor.return(undefined);
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.pendingCursor.return(undefined);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Tool ranking cursor cleanup failed');
  }
}
