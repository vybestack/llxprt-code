/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ObservedHistory } from './streamprocessor-source-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { BoundarySnapshotDisk } from '../../boundary-snapshot-disk.js';

export interface ModelBodyObserver {
  firstLive(): number;
  lastLive(): number;
  boundaryFacts(): {
    first: number;
    last: number;
    closed: number;
    reads: number;
  };
  restore(): void;
}
async function liveRows(references: Array<WeakRef<IContent>>): Promise<number> {
  for (let round = 0; round < 8; round++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
  return references.filter((row) => row.deref() !== undefined).length;
}

function observeBoundary(): {
  references: Array<WeakRef<IContent>>;
  closed(): number;
  restore(): void;
} {
  const references: Array<WeakRef<IContent>> = [];
  const retained: IContent[] = [];
  const row = BoundarySnapshotDisk.prototype.row;
  const close = BoundarySnapshotDisk.prototype.close;
  let closed = 0;
  BoundarySnapshotDisk.prototype.row = function (...args): IContent {
    const result = row.apply(this, args);
    references.push(new WeakRef(result));
    if (process.env.ISSUE854_RETAIN_BOUNDARY_ROWS === '1')
      retained.push(result);
    return result;
  };
  BoundarySnapshotDisk.prototype.close = function (...args): void {
    closed++;
    close.apply(this, args);
  };
  return {
    references,
    closed: () => closed,
    restore: () => {
      BoundarySnapshotDisk.prototype.row = row;
      BoundarySnapshotDisk.prototype.close = close;
      retained.length = 0;
    },
  };
}

export function observeModelBody(history: ObservedHistory): ModelBodyObserver {
  const fetch = globalThis.fetch;
  const boundary = observeBoundary();
  let firstLive = -1;
  let lastLive = -1;
  let boundaryFirst = -1;
  let boundaryLast = -1;
  globalThis.fetch = Object.assign(
    async (...[input, init]: Parameters<typeof fetch>): Promise<Response> => {
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected progressive source BODY');
      const reader = init.body.getReader();
      let first = true;
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller): Promise<void> {
            try {
              const next = await reader.read();
              if (next.done) {
                lastLive = await liveRows(history.references);
                boundaryLast = await liveRows(boundary.references);
                reader.releaseLock();
                controller.close();
                return;
              }
              if (first) {
                first = false;
                firstLive = await liveRows(history.references);
                boundaryFirst = await liveRows(boundary.references);
              }
              controller.enqueue(next.value);
            } catch (error) {
              reader.releaseLock();
              controller.error(error);
            }
          },
          async cancel(reason): Promise<void> {
            try {
              await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          },
        },
        { highWaterMark: 0 },
      );
      return fetch(input, { ...init, body });
    },
    { preconnect: fetch.preconnect },
  );
  return {
    firstLive: () => firstLive,
    lastLive: () => lastLive,
    boundaryFacts: () => ({
      first: boundaryFirst,
      last: boundaryLast,
      closed: boundary.closed(),
      reads: boundary.references.length,
    }),
    restore: () => {
      globalThis.fetch = fetch;
      boundary.restore();
    },
  };
}
