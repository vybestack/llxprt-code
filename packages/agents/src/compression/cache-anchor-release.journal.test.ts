/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { applyCompressionWithAnchor } from './__tests__/support/cacheAnchor.js';

function row(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function texts(rows: readonly IContent[]): string[] {
  return rows.map((content) => {
    const block = content.blocks[0];
    if (block.type !== 'text') throw new Error('Expected text fixture');
    return block.text;
  });
}

async function snapshotTexts(
  snapshot: Promise<Awaited<ReturnType<JournalSession['store']['snapshot']>>>,
): Promise<string[]> {
  const dump = new JournalDumpSnapshot(await snapshot);
  const rows: IContent[] = [];
  try {
    for await (const content of dump.rows()) rows.push(content);
    return texts(rows);
  } finally {
    await dump.close();
  }
}

async function assertRelease(
  history: HistoryService,
  session: JournalSession,
): Promise<number> {
  await history.addBatch([
    row('human', 'original-1'),
    row('ai', 'original-2'),
    row('human', 'original-3'),
  ]);
  const stamped = await collectRawHistory(history);
  const summary = {
    ...row('ai', 'compressed'),
    metadata: { isSummary: true, synthetic: true },
  };
  const candidate = [stamped[0], stamped[1], summary, stamped[2]];
  const observed: string[] = [];
  let atRelease: Promise<string[]> | undefined;
  history.on('contentAdded', (content) => {
    observed.push(`contentAdded:${texts([content])[0]}`);
  });
  history.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
    expect(history.getStatistics().totalMessages).toBe(4);
    atRelease = snapshotTexts(session.store.snapshot());
  });
  history.on('compressionEnded', () => observed.push('compressionEnded'));
  history.startCompression();
  history.add(row('human', 'pre-helper-stream'));
  await applyCompressionWithAnchor(history, candidate, 2, 'test-model');
  expect(observed).toStrictEqual([]);
  history.add(row('ai', 'post-helper-stream'));
  history.endCompression(row('ai', 'done'), stamped.length);
  await history.waitForCommit();
  const releaseTexts = await atRelease;
  expect(observed).toStrictEqual([
    'compressionLockReleased',
    'compressionEnded',
    'contentAdded:pre-helper-stream',
    'contentAdded:post-helper-stream',
  ]);
  expect(releaseTexts).toStrictEqual([
    'original-1',
    'original-2',
    'compressed',
    'original-3',
  ]);
  expect(texts(await collectRawHistory(history))).toStrictEqual([
    'original-1',
    'original-2',
    'compressed',
    'original-3',
    'pre-helper-stream',
    'post-helper-stream',
  ]);
  return history.getCacheAnchorSeq();
}

describe('native cache-anchor publication under a compression lock (#3338)', () => {
  it('pins the exact rebuild at release before both ordinary streaming additions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cache-anchor-release-'));
    const session = await JournalSession.create(
      join(directory, 'primary.llxj'),
    );
    const opener = spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
      session,
    );
    const history = new HistoryService({ backend: 'journal' });
    opener.mockRestore();
    try {
      expect(await assertRelease(history, session)).toBe(2);
    } finally {
      await history.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
