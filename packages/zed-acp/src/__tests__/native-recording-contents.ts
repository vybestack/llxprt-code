/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { stateReaderOf } from '@vybestack/llxprt-code-core/journal/journalReaderState.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { readSessionFacts } from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';

export async function nativeRecordingContents(path: string): Promise<string> {
  const factsReader = await openJournalReadOnly(path);
  let metadata: string;
  try {
    const facts = await readSessionFacts(
      stateReaderOf(factsReader, sha256KeyHash),
    );
    if (facts === undefined) throw new Error('Recording has no session facts');
    metadata = JSON.stringify(facts);
  } finally {
    await factsReader.close();
  }
  const reader = await NativeJournalPageReader.open(path);
  const rows: string[] = [];
  try {
    for await (const entry of reader.entries())
      rows.push(JSON.stringify(await reader.readContent(entry)));
  } finally {
    await reader.close();
  }
  return metadata + '\n' + rows.join('\n');
}
