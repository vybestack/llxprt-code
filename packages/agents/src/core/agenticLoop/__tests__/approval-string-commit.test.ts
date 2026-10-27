/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import {
  JournalDisplayWriter,
  approvalRelationKey,
} from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';

describe('complete approval journal writes', () => {
  const dir = useTempDir('approval-string-commit-');
  it('publishes each complete approval decision and its relation under one durable trailer', async () => {
    const path = join(dir(), 'approval.llxj');
    const session = await JournalSession.create(path);
    try {
      const before = session.store.published?.commitSeq ?? 0;
      const writer = new JournalDisplayWriter(session.store);
      const payload = JSON.stringify({
        status: 'scheduled',
        outcome: 'proceed_once',
      });
      const row = await writer.append(
        {
          type: 'tool-approval',
          attemptId: 'attempt',
          callId: 'call',
          format: 'json',
        },
        payload,
      );
      const reader = await NativeJournalPageReader.open(path);
      try {
        const entry = await reader.entries().next();
        if (entry.value === undefined)
          throw new Error('Missing durable decision');
        expect(entry.value.transcriptId).toBe(row.transcriptId);
        expect((await reader.presentation(entry.value))?.descriptor.type).toBe(
          'tool-approval',
        );
        const content = await reader.readContent(entry.value);
        expect(content.blocks).toStrictEqual([{ type: 'text', text: payload }]);
        expect(
          new TextDecoder().decode(
            await session.store.getState(
              approvalRelationKey('attempt', 'call'),
            ),
          ),
        ).toBe(row.transcriptId.toString());
        expect(session.store.published?.commitSeq).toBeLessThanOrEqual(
          before + 1,
        );
      } finally {
        await reader.close();
      }
    } finally {
      await session.close();
    }
  });
});
