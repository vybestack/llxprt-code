/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NeutralMergeQueue } from '@vybestack/llxprt-code-core/utils/neutral-merge-queue.js';

export function observeMergeWork(): {
  readonly operations: () => number;
  readonly restore: () => void;
} {
  const add = NeutralMergeQueue.prototype.add;
  const take = NeutralMergeQueue.prototype.take;
  let operations = 0;
  NeutralMergeQueue.prototype.add = function (
    this: NeutralMergeQueue,
    rank: number,
    position: number,
  ): void {
    operations++;
    add.call(this, rank, position);
  };
  NeutralMergeQueue.prototype.take = function (
    this: NeutralMergeQueue,
  ): number | undefined {
    operations++;
    return take.call(this);
  };
  return {
    operations: () => operations,
    restore: () => {
      NeutralMergeQueue.prototype.add = add;
      NeutralMergeQueue.prototype.take = take;
    },
  };
}
