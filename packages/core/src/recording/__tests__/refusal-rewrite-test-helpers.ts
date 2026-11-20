import { JournalRecordingService } from '../journalRecordingService.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  withNativeDetachedFixture,
  type NativeDetachedFixture,
} from '../../services/history/__tests__/support/detached-contract-fixture.js';
import type { DetachedHistoryOptions } from '../../services/history/detachedHistoryMutation.js';
import type { IContent } from '../../services/history/IContent.js';
import { ScratchRootOwner } from '../../storage/scratch-root.js';
import { RecordingIntegration } from '../RecordingIntegration.js';
import type { RefusalRewritePayload } from '../types.js';

export const ORIGINAL = 'The agent kills surviving mutants in src/a.ts';
export const REWRITTEN = 'The agent terminates surviving mutants in src/a.ts';
export function summary(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true },
  };
}
export function rewritePayload(): RefusalRewritePayload {
  return {
    operationId: 'op-1',
    time: '2026-11-12T10:00:00.000Z',
    promptId: 'prompt-1',
    attemptIndex: 2,
    reviewer: {
      profile: 'sonnet-reviewer',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    },
    explanation: 'Plain wording for a mutation-testing summary.',
    changes: [
      {
        id: 'c1.0',
        role: 'human',
        kind: 'summary',
        originalText: ORIGINAL,
        newText: REWRITTEN,
      },
    ],
  };
}
export async function textsOf(
  rows: AsyncIterable<IContent>,
): Promise<string[]> {
  const texts: string[] = [];
  for await (const row of rows)
    for (const block of row.blocks)
      if (block.type === 'text') texts.push(block.text);
  return texts;
}
export async function rewriteSummary(
  fixture: NativeDetachedFixture,
  options: DetachedHistoryOptions = {},
): Promise<void> {
  const isCurrent = fixture.history.historyMutationGuard();
  await fixture.history.detachedValues.transform(
    async (source, sink) => {
      let ordinal = 0;
      for await (const row of source.streamRows(options.signal)) {
        await sink.appendDerived(
          ordinal,
          ordinal === 0
            ? {
                ...row,
                blocks: row.blocks.map((block) =>
                  block.type === 'text' ? { ...block, text: REWRITTEN } : block,
                ),
              }
            : row,
        );
        ordinal++;
      }
    },
    undefined,
    {
      assertCurrent: () => {
        if (!isCurrent()) throw new Error('Stale review');
      },
      publishBatch: true,
      audit: {
        key: 'refusal_rewrite:op-1',
        value: new TextEncoder().encode(JSON.stringify(rewritePayload())),
      },
      ...options,
    },
  );
}
export async function auditRecords(
  fixture: NativeDetachedFixture,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for await (const entry of fixture.session.store.metadata(
    'refusal_rewrite:',
    'meta',
  ))
    records.push(JSON.parse(new TextDecoder().decode(entry.value)));
  return records;
}
export async function rewriteState(fixture: NativeDetachedFixture) {
  if (!(fixture.recording instanceof JournalRecordingService))
    throw new Error('Expected native recording service');
  const mirror = await fixture.recording.session();
  const audit = await fixture.session.store.getMeta('refusal_rewrite:op-1');
  const mirrorAudit = await mirror.store.getMeta('refusal_rewrite:op-1');
  if (!Buffer.from(audit ?? []).equals(Buffer.from(mirrorAudit ?? [])))
    throw new Error('Rewrite audits differ across journals');
  return {
    live: await textsOf(fixture.history.streamRawHistory()),
    persisted: await textsOf(fixture.persistedRows()),
    rewriteRecords: (await auditRecords(fixture)).map(() => 'refusal_rewrite'),
  };
}
export async function withRewriteFixture(
  action: (
    fixture: NativeDetachedFixture,
    integration: RecordingIntegration,
  ) => Promise<void>,
): Promise<void> {
  await withNativeDetachedFixture(async (fixture) => {
    const integration = new RecordingIntegration(
      fixture.recording,
      new ScratchRootOwner(),
    );
    await integration.subscribeToJournal(fixture.history);
    try {
      await fixture.history.addBatch([summary(ORIGINAL)]);
      await integration.flushAtTurnBoundary();
      await action(fixture, integration);
    } finally {
      await integration.dispose();
    }
  });
}
