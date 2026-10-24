/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { IContent } from '@vybestack/llxprt-code-core';

export type NativePagerEdit =
  | IContent
  | { readonly removed: number; readonly cutSeq?: number };

async function popRows(
  session: JournalSession,
  edit: Exclude<NativePagerEdit, IContent>,
): Promise<void> {
  const count = session.store.published?.rows ?? 0;
  const ordinal = edit.cutSeq === undefined ? count - edit.removed : 0;
  for await (const { entry, content } of session.rows(ordinal)) {
    if (
      edit.cutSeq === undefined ||
      (content.metadata?.chronology?.seq ?? 0) >= edit.cutSeq
    ) {
      await session.store.commit([
        { kind: 'pop', cutLabel: entry.label, expectedRemoved: edit.removed },
      ]);
      return;
    }
  }
  throw new Error('Missing native rewind cut');
}

export async function writeNativeEdits(
  file: string,
  edits: readonly NativePagerEdit[],
  append = false,
): Promise<void> {
  const session = await (append
    ? JournalSession.open(file)
    : JournalSession.create(file));
  try {
    let pending: IContent[] = [];
    for (const edit of edits) {
      if ('speaker' in edit) pending.push(edit);
      else {
        await session.append(pending);
        pending = [];
        await popRows(session, edit);
      }
    }
    await session.append(pending);
  } finally {
    await session.close();
  }
}
