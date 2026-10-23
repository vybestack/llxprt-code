import { HistoryService } from './HistoryService.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { IContent } from './IContent.js';

/**
 * The journal twin of "captures pending values before returning control to
 * the caller" in dump-snapshot-values.test.ts. The old store fixes the dump
 * at the call. The journal dump is the version durable when its open
 * resolves: a row added while it opens is in it, and the values are bytes
 * encoded when each row was added, so what a caller does to its own object
 * afterwards changes nothing.
 */
function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `original-${index}` }],
  };
}

describe('dump snapshot values on the journal store', () => {
  let history: HistoryService;
  beforeEach(() => {
    history = new HistoryService();
  });
  afterEach(async () => {
    await history.dispose();
  });

  it('holds the rows durable when it opens, as they were added', async () => {
    const original = row(0);
    history.add(original);
    const expected = structuredClone(original);
    const opening = history.openDumpSnapshot();
    original.blocks = [{ type: 'text', text: 'changed after capture' }];
    history.add(row(1));
    const snapshot = await opening;
    try {
      const values: IContent[] = [];
      for await (const value of snapshot.rows()) values.push(value);
      expect(values.map((value) => value.blocks)).toStrictEqual([
        expected.blocks,
        row(1).blocks,
      ]);
      const trace = [];
      for await (const entry of snapshot.chronology()) trace.push(entry);
      expect(trace).toHaveLength(2);
    } finally {
      await snapshot.close();
    }
  });
});
