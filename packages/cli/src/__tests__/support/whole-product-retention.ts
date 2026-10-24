/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core';

async function* observedReader(
  source: AsyncGenerator<IContent>,
  observe: (row: IContent, first: boolean) => void,
): AsyncGenerator<IContent> {
  let first = true;
  for await (const row of source) {
    observe(row, first);
    first = false;
    yield row;
  }
}

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
    const rows = snapshot.native?.indexed;
    const open = snapshot.openReader.bind(snapshot);
    const observe = (row: IContent, first: boolean): void => {
      if (measuring) {
        if (trap) retained.push(row);
        if (allRows || first) weak.push(new WeakRef(row));
      } else if (first) {
        warm.push(new WeakRef(row));
      }
    };
    if (rows !== undefined) {
      const indexedOpen = rows.openReader.bind(rows);
      const read = rows.readAt.bind(rows);
      rows.openReader = (signal) =>
        observedReader(indexedOpen(signal), observe);
      rows.readAt = async (index, signal): Promise<IContent> => {
        const row = await read(index, signal);
        observe(row, true);
        return row;
      };
    }
    return {
      ...(snapshot.native === undefined ? {} : { native: snapshot.native }),
      ...(snapshot.callerOwned === true ? { callerOwned: true } : {}),
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      readAt: (index, signal) => snapshot.readAt(index, signal),
      close: async (): Promise<void> => {
        await snapshot.close();
        if (measured && !released) closed++;
        released = true;
      },
      openReader: (signal) =>
        rows === undefined
          ? observedReader(open(signal), observe)
          : open(signal),
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
