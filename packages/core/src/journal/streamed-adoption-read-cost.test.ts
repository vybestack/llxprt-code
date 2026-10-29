/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import { detachedRows } from '../services/history/detached-rollback-test-helpers.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import type { SourceRow } from './groupEdits.js';
import type { RecordAccess } from './recordAccess.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';

async function assertRows(
  before: VersionSnapshot,
  after: VersionSnapshot,
  size: number,
): Promise<void> {
  const input = before.entries();
  let rows = 0;
  for await (const entry of after.entries()) {
    const original = await input.next();
    if (original.done === true) throw new Error('Adoption produced extra rows');
    expect(await after.readRow(entry)).toStrictEqual(
      await before.readRow(original.value),
    );
    rows++;
  }
  expect(rows).toBe(size);
  expect(after.version?.aggregate).toStrictEqual(before.version?.aggregate);
}

describe('streamed recording adoption read cost', () => {
  const directory = useTempDir('streamed-adoption-cost-');
  it.each([512, 8192])(
    'reads each of %i adopted row headers once per mirror',
    async (size) => {
      const source = await JournalSession.create(
        join(directory(), `source-${size}.llxj`),
        {
          journal: testJournalSeams().dependencies,
        },
      );
      const target = await JournalSession.create(
        join(directory(), `target-${size}.llxj`),
        {
          journal: testJournalSeams().dependencies,
        },
      );
      try {
        await source.store.commit([
          {
            kind: 'replace',
            rows: (async function* () {
              for await (const row of detachedRows(size))
                yield encodeContentRow(row, { owner: 0 });
            })(),
          },
        ]);
        const snapshot = await source.store.snapshot();
        const read = await source.store.openRead();
        try {
          let headers = 0;
          const access: RecordAccess = {
            ...read.access,
            readRecordHead: (offset, what, prefetch) => {
              if (what === 'ROW') headers++;
              return read.access.readRecordHead(offset, what, prefetch);
            },
            readRecordStart: (offset, what, prefetch) => {
              if (what === 'ROW') headers++;
              return read.access.readRecordStart(offset, what, prefetch);
            },
          };
          await target.store.commit([
            {
              kind: 'prepared',
              admission: [],
              prepare: (group) =>
                group.adopt(
                  (async function* (): AsyncGenerator<SourceRow> {
                    for await (const entry of snapshot.entries())
                      yield { entry, source: access };
                  })(),
                  snapshot.version?.nextLabel ?? 0n,
                ),
            },
          ]);
          process.stdout.write(
            `STREAMED_ADOPTION_COST ${JSON.stringify({ size, headers, headersPerRow: headers / size })}\n`,
          );
          expect(headers).toBe(size);
          const after = await target.store.snapshot();
          try {
            await assertRows(snapshot, after, size);
          } finally {
            await after.close();
          }
        } finally {
          await snapshot.close();
          await read.close();
        }
      } finally {
        await source.close();
        await target.close();
      }
    },
    180000,
  );
});
