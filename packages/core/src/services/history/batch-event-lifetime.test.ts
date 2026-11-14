/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import type { IContent } from './IContent.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import {
  withValueTransformFixture,
  sweepTransformRows,
} from './transform-value-test-helpers.js';
import { batchRowSource, eventRows } from './batch-event-test-helpers.js';

async function heldHandleProbes(size: number): Promise<void> {
  await withValueTransformFixture(async ({ history, owners }) => {
    const probes: Array<WeakRef<IContent>> = [];
    const handles: {
      view?: HistoryBatchRowSource;
      cursor?: AsyncGenerator<IContent, void, unknown>;
    } = {};
    let reading: Promise<void> | undefined;
    history.once('contentBatchAdded', (value) => {
      handles.view = batchRowSource(value);
      const cursor = handles.view.rows();
      handles.cursor = cursor;
      reading = (async (): Promise<void> => {
        let item = await cursor.next();
        while (item.done !== true) {
          probes.push(new WeakRef(item.value));
          item = await cursor.next();
        }
      })();
    });
    await history.detachedValues.replace(eventRows(size), undefined, {
      publishBatch: true,
    });
    await reading;
    reading = undefined;
    await sweepTransformRows();
    const liveOrdinals = probes.flatMap((probe, index) =>
      probe.deref() === undefined ? [] : [index],
    );
    const output = process.env.BATCH_EVENT_LIFETIME_OUTPUT;
    if (output !== undefined)
      appendFileSync(
        output,
        JSON.stringify({ size, liveOrdinals, owners: owners.snapshot() }) +
          '\n',
      );
    expect(probes.length).toBe(size);
    expect(liveOrdinals).toStrictEqual([]);
    expect(owners.snapshot().liveRows).toBe(0);
    if (handles.view === undefined || handles.cursor === undefined)
      throw new Error('Missing published batch handles');
    await expect(handles.view.rows().next()).rejects.toThrow('retired');
    expect(await handles.cursor.next()).toStrictEqual({
      done: true,
      value: undefined,
    });
  });
}
describe('retained closed batch handles do not pin decoded history', () => {
  it.each([512, 8192])(
    'releases all %i event row probes while the handles remain reachable',
    async (size) => {
      expect(await heldHandleProbes(size)).toBeUndefined();
    },
    120000,
  );
});
