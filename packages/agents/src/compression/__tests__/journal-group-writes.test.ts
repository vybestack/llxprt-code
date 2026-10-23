/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import {
  densityRow,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';
import {
  decodeStoredRow,
  encodeContentRow,
} from '../../../../core/src/services/history/journalRowCodec.js';

async function sessionDigest(session: JournalSession): Promise<string> {
  const snapshot = await session.store.snapshot();
  try {
    return await digestStream(
      (async function* () {
        for await (const entry of snapshot.entries())
          yield decodeStoredRow(await snapshot.readRow(entry));
      })(),
    );
  } finally {
    await snapshot.close();
  }
}

describe('compression journal group writes', () => {
  const directory = useTempDir('compression-group-writes-');

  for (const size of [512, 8192])
    it(`streams ${size} normalized rows without a descriptor write per row`, async () => {
      let writes = 0;
      const session = await JournalSession.create(`${directory()}/group.llxj`, {
        journal: {
          open: async (path, flags) => {
            const handle = await open(path, flags);
            return {
              fd: handle.fd,
              read: (...args) => handle.read(...args),
              stat: () => handle.stat(),
              truncate: (length) => handle.truncate(length),
              close: () => handle.close(),
              write: (...args) => {
                writes++;
                return handle.write(...args);
              },
              writev: (...args) => {
                writes++;
                return handle.writev(...args);
              },
            };
          },
        },
      });
      try {
        await session.store.commit([
          {
            kind: 'replace',
            rows: (function* () {
              for (let index = 0; index < size; index++)
                yield encodeContentRow(densityRow(index), { owner: 0 });
            })(),
          },
        ]);
        expect(writes).toBeLessThan(size / 2);
        expect(await sessionDigest(session)).toBe(
          digestRows(
            Array.from({ length: size }, (_, index) => densityRow(index)),
          ),
        );
      } finally {
        await session.close();
      }
    }, 120_000);
});
