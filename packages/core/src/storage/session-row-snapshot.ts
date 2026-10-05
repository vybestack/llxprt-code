/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IContent } from '../services/history/IContent.js';
import type { PersistedSession } from './SessionPersistenceService.js';

export async function saveSessionRowSnapshot(
  target: string,
  session: PersistedSession,
  rows: AsyncIterable<IContent>,
  writeRow: (
    row: IContent,
    write: (encoded: string) => Promise<void>,
  ) => Promise<void>,
  accountWrite: (encoded: string, write: () => Promise<void>) => Promise<void>,
  observePendingRow?: () => Promise<void>,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      const { history: _history, ...header } = session;
      const write = (encoded: string): Promise<void> =>
        accountWrite(encoded, () => file.writeFile(encoded));
      await write(`${JSON.stringify(header).slice(0, -1)},"history":[`);
      let separator = '';
      for await (const row of rows) {
        await writeRow(row, async (encoded) => {
          const bytes = `${separator}${encoded}`;
          await accountWrite(bytes, async () => {
            await observePendingRow?.();
            await file.writeFile(bytes);
          });
          separator = ',';
        });
      }
      await write(']}');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
