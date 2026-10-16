/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import type { IContent } from './IContent.js';
import {
  withValueTransformFixture,
  sweepTransformRows,
} from './transform-value-test-helpers.js';
import {
  batchValues,
  eventRows,
  type BatchTestCursor,
  type BatchTestValues,
} from './batch-event-test-helpers.js';

async function heldHandleProbes(size: number): Promise<void> {
  await withValueTransformFixture(async ({ history, owners }) => {
    const probes: Array<WeakRef<IContent>> = [];
    const handles: { view?: BatchTestValues; cursor?: BatchTestCursor } = {};
    history.once('contentBatchAdded', (value) => {
      handles.view = batchValues(value);
      handles.view.withRows((cursor) => {
        handles.cursor = cursor;
        for (let item = cursor.next(); item.done !== true; item = cursor.next())
          probes.push(new WeakRef(item.value));
      });
    });
    await history.detachedValues.replace(eventRows(size), undefined, {
      publishBatch: true,
    });
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
    expect(() => handles.view?.withRows(() => undefined)).toThrow('closed');
    expect(() => handles.cursor?.next()).toThrow('closed');
  });
}
describe('retained closed batch handles do not pin decoded history', () => {
  it.each([512, 8192])(
    'releases all %i event row probes while the handles remain reachable',
    async (size) => {
      await expect(heldHandleProbes(size)).resolves.toBeUndefined();
    },
    120000,
  );
});
