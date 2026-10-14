/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  inMemoryRequestSelection,
  type ProviderRequestRows,
  type ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { textRow } from '../__tests__/requestRowsTestSupport.js';
import { providerRowsOf } from './providerRows.js';
import { acquireRequestRows } from './requestRowsLease.js';

function rowsOf(size: number): IContent[] {
  return Array.from({ length: size }, (_, i) => textRow(`row ${i}`));
}

async function read(rows: ProviderRequestRows): Promise<string[]> {
  const texts: string[] = [];
  for await (const row of rows.openReader()) {
    const block = row.blocks[0];
    if (block.type !== 'text') throw new Error('Expected a text block');
    texts.push(block.text);
  }
  return texts;
}

function oneShot(rows: IContent[], pulled: { count: number }) {
  return (async function* () {
    for (const row of rows) {
      pulled.count++;
      yield structuredClone(row);
    }
  })();
}

describe('providerRowsOf with a request selection', () => {
  it('returns the selection rows, count and random access without a history array', async () => {
    const selection = inMemoryRequestSelection(rowsOf(5));
    const rows = await providerRowsOf({
      requestRows: selection,
      contents: (async function* () {})(),
    });
    expect(rows.count).toBe(5);
    expect(await read(rows)).toStrictEqual(
      [0, 1, 2, 3, 4].map((i) => `row ${i}`),
    );
    expect(await read(rows)).toHaveLength(5);
    expect(rows.readAt(3)).toBe(selection.readAt(3));
  });

  it('prefers requestRows over the contents stream and never pulls the stream', async () => {
    const pulled = { count: 0 };
    const rows = await providerRowsOf({
      requestRows: inMemoryRequestSelection(rowsOf(2)),
      contents: oneShot(rowsOf(9), pulled),
    });
    expect(await read(rows)).toHaveLength(2);
    expect(pulled.count).toBe(0);
  });

  it('fails a pass that yields fewer rows than the count', async () => {
    const selection = inMemoryRequestSelection(rowsOf(4));
    const shrunk: ProviderRequestSelection = {
      count: 4,
      close: () => undefined,
      readAt: selection.readAt,
      async *openReader(signal) {
        let n = 0;
        for await (const row of selection.openReader(signal)) {
          if (n++ === 3) return;
          yield row;
        }
      },
    };
    const rows = await providerRowsOf({
      requestRows: shrunk,
      contents: (async function* () {})(),
    });
    await expect(read(rows)).rejects.toThrow(
      'Provider request rows count changed',
    );
  });

  it('fails a pass that yields more rows than the count, before the extra row', async () => {
    const extra = rowsOf(3);
    const grown: ProviderRequestSelection = {
      count: 2,
      close: () => undefined,
      readAt: (index) => extra[index],
      async *openReader() {
        yield* extra;
      },
    };
    const rows = await providerRowsOf({
      requestRows: grown,
      contents: (async function* () {})(),
    });
    const seen: IContent[] = [];
    const pass = (async () => {
      for await (const row of rows.openReader()) seen.push(row);
    })();
    await expect(pass).rejects.toThrow('Provider request rows count changed');
    expect(seen).toHaveLength(2);
  });

  it('rejects a row position outside the selection', async () => {
    const rows = await providerRowsOf({
      requestRows: inMemoryRequestSelection(rowsOf(2)),
      contents: (async function* () {})(),
    });
    expect(() => rows.readAt(2)).toThrow(RangeError);
  });
});

describe('providerRowsOf with the staged disk reader', () => {
  it('stages a one-shot stream once and serves repeatable passes and random access', async () => {
    const pulled = { count: 0 };
    const scope = acquireRequestRows({
      contents: oneShot(rowsOf(40), pulled),
    });
    try {
      const rows = await providerRowsOf(scope.options);
      expect(rows.count).toBe(40);
      expect(pulled.count).toBe(40);
      const expected = rowsOf(40).map((_, i) => `row ${i}`);
      expect(await read(rows)).toStrictEqual(expected);
      expect(await read(rows)).toStrictEqual(expected);
      expect(rows.readAt(37)).toStrictEqual(textRow('row 37'));
      expect(rows.readAt(0)).toStrictEqual(textRow('row 0'));
      expect(pulled.count).toBe(40);
      expect(() => rows.readAt(40)).toThrow(RangeError);
      const again = await providerRowsOf(scope.options);
      expect(again.count).toBe(40);
      expect(pulled.count).toBe(40);
    } finally {
      await scope.close();
    }
  });

  it('completes the staging when some rows were already read by another reader', async () => {
    const pulled = { count: 0 };
    const scope = acquireRequestRows({
      contents: oneShot(rowsOf(6), pulled),
    });
    try {
      const early = scope.options.contents[Symbol.asyncIterator]();
      await early.next();
      await early.next();
      const rows = await providerRowsOf(scope.options);
      expect(rows.count).toBe(6);
      expect(await read(rows)).toHaveLength(6);
      await early.return?.();
    } finally {
      await scope.close();
    }
  });

  it('stages an empty stream as zero rows', async () => {
    const scope = acquireRequestRows({ contents: oneShot([], { count: 0 }) });
    try {
      const rows = await providerRowsOf(scope.options);
      expect(rows.count).toBe(0);
      expect(await read(rows)).toStrictEqual([]);
      expect(() => rows.readAt(0)).toThrow(RangeError);
    } finally {
      await scope.close();
    }
  });

  it('uses the request selection when the lease wraps one', async () => {
    const scope = acquireRequestRows({
      contents: (async function* () {})(),
      requestRows: inMemoryRequestSelection(rowsOf(3)),
    });
    try {
      const rows = await providerRowsOf(scope.options);
      expect(rows.count).toBe(3);
      expect(await read(rows)).toHaveLength(3);
    } finally {
      await scope.close();
    }
  });

  it('refuses rows after the lease is closed', async () => {
    const scope = acquireRequestRows({
      contents: oneShot(rowsOf(3), { count: 0 }),
    });
    const rows = await providerRowsOf(scope.options);
    await scope.close();
    expect(() => rows.readAt(0)).toThrow('Provider request rows are closed');
    await expect(read(rows)).rejects.toThrow(
      'Provider request rows are closed',
    );
  });

  it('rejects a stream that was not staged by acquireRequestRows', async () => {
    await expect(
      providerRowsOf({ contents: oneShot(rowsOf(2), { count: 0 }) }),
    ).rejects.toThrow('Provider request rows were not staged');
  });
});

describe('providerRowsOf cancellation', () => {
  it('rejects before reading when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('request cancelled'));
    const pulled = { count: 0 };
    await expect(
      providerRowsOf({
        contents: oneShot(rowsOf(3), pulled),
        metadata: { abortSignal: controller.signal },
      }),
    ).rejects.toThrow('request cancelled');
    expect(pulled.count).toBe(0);
  });

  it('stops a pass and a random read once the request is aborted', async () => {
    const controller = new AbortController();
    const rows = await providerRowsOf({
      requestRows: inMemoryRequestSelection(rowsOf(10)),
      contents: (async function* () {})(),
      metadata: { abortSignal: controller.signal },
    });
    expect(rows.readAt(1)).toStrictEqual(textRow('row 1'));
    const seen: IContent[] = [];
    const pass = (async () => {
      for await (const row of rows.openReader()) {
        seen.push(row);
        if (seen.length === 3) controller.abort(new Error('request cancelled'));
      }
    })();
    await expect(pass).rejects.toThrow('request cancelled');
    expect(seen).toHaveLength(3);
    expect(() => rows.readAt(0)).toThrow('request cancelled');
  });

  it('aborts staging of a one-shot stream mid-drain', async () => {
    const controller = new AbortController();
    const pulled = { count: 0 };
    const scope = acquireRequestRows(
      {
        contents: (async function* () {
          for (const row of rowsOf(1000)) {
            pulled.count++;
            if (pulled.count === 5)
              controller.abort(new Error('drain cancelled'));
            yield row;
          }
        })(),
      },
      undefined,
      controller.signal,
    );
    try {
      await expect(providerRowsOf(scope.options)).rejects.toThrow(
        /Aborted|drain cancelled/,
      );
      expect(pulled.count).toBeLessThan(1000);
    } finally {
      await scope.close();
    }
  });
});
