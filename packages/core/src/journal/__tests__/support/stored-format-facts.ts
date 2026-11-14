/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalStore } from '../../journalStore.js';

export async function storedFacts(store: JournalStore): Promise<Uint8Array[]> {
  const read = await store.openRead();
  const facts: Uint8Array[] = [];
  try {
    for await (const entry of store.rows()) {
      facts.push(entry.summary[0]);
      const head = await read.access.readRecordHead(entry.lensRef[0]);
      const chunks: Uint8Array[] = [];
      for await (const chunk of read.access.readRecordBody(head))
        chunks.push(chunk);
      facts.push(Buffer.concat(chunks));
    }
    return facts;
  } finally {
    await read.close();
  }
}
