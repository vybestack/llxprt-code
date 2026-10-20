/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core';

export function observeWholeProductRetention(
  trap: boolean,
  allRows = false,
): {
  start(): void;
  retained(): number;
  weakRows(): ReadonlyArray<WeakRef<IContent>>;
  warmRows(): ReadonlyArray<WeakRef<IContent>>;
  lifetime(): { prepared: number; closed: number; outstanding: number };
  restore(): void;
} {
  const prepare = HistoryService.prototype.prepareCuratedForProviderSnapshot;
  const retained: IContent[] = [];
  const weak: Array<WeakRef<IContent>> = [];
  const warm: Array<WeakRef<IContent>> = [];
  let measuring = false;
  let prepared = 0;
  let closed = 0;
  HistoryService.prototype.prepareCuratedForProviderSnapshot = async function (
    ...args
  ) {
    const snapshot = await prepare.apply(this, args);
    const measured = measuring;
    if (measured) prepared++;
    let released = false;
    return {
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      readAt: (index, signal) => snapshot.readAt(index, signal),
      close: (): void => {
        snapshot.close();
        if (measured && !released) closed++;
        released = true;
      },
      async *openReader(signal): AsyncGenerator<IContent> {
        let observed = false;
        for await (const row of snapshot.openReader(signal)) {
          if (measuring) {
            if (trap) retained.push(row);
            if (allRows || !observed) weak.push(new WeakRef(row));
          } else if (!observed) {
            warm.push(new WeakRef(row));
          }
          observed = true;
          yield row;
        }
      },
    };
  };
  return {
    start: (): void => {
      measuring = true;
    },
    retained: () => retained.length,
    weakRows: () => weak,
    warmRows: () => warm,
    lifetime: () => ({ prepared, closed, outstanding: prepared - closed }),
    restore: (): void => {
      HistoryService.prototype.prepareCuratedForProviderSnapshot = prepare;
      retained.length = 0;
    },
  };
}
