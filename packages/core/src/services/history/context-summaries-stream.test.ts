/** Copyright 2026 Vybestack LLC. Licensed under the Apache, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { resumeSession } from '../../recording/resumeSession.js';
import type { IContent } from './IContent.js';
import type { ContextSummaryInfo } from './historyEventTypes.js';
import { HistoryService } from './HistoryService.js';

// Historical eager projection, kept separate from the streaming implementation.
function eagerOracle(rows: readonly IContent[]): ContextSummaryInfo[] {
  const result: ContextSummaryInfo[] = [];
  for (const row of rows) {
    const span = row.metadata?.chronologyReplaced;
    if (span === undefined) continue;
    let text = '';
    for (const block of row.blocks)
      if (block.type === 'text') text += block.text;
    result.push({
      seq: row.metadata?.chronology?.seq ?? 0,
      replacedFromSeq: span.fromSeq,
      replacedToSeq: span.toSeq,
      itemCount: span.toSeq - span.fromSeq + 1,
      text,
    });
  }
  return result;
}

function row(index: number, summary = false): IContent {
  return {
    speaker: index % 2 === 1 ? 'ai' : 'human',
    blocks: summary
      ? [
          { type: 'text', text: `summary-${index}` },
          { type: 'text', text: '-tail' },
        ]
      : [{ type: 'text', text: `row-${index}` }],
    metadata: {
      chronology: {
        seq: index + 1,
        step: 1,
        userTurn: index + 1,
        recordedAt: 0,
      },
      ...(summary
        ? {
            chronologyReplaced: {
              fromSeq: index + 10,
              toSeq: index + 13,
              itemCount: 4,
            },
          }
        : {}),
    },
  };
}

function recorder(root: string): SessionRecordingService {
  return new SessionRecordingService({
    sessionId: 'context-summary-stream',
    projectHash: 'context-summary-stream',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    maxQueueBytes: Infinity,
  });
}

async function withJournal(
  action: (recording: SessionRecordingService) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'context-summary-stream-'),
  );
  const recording = recorder(root);
  try {
    await action(recording);
  } finally {
    await recording.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Limit the source check to the public method, so the next facade migration
// can still have outstanding eager returns elsewhere in the class.
function summaryMethodBody(source: string): string {
  const start = source.indexOf('getContextSummaries():');
  const end = source.indexOf('\n  /**', start);
  if (start < 0 || end < 0) throw new Error('Missing summary method');
  return source.slice(start, end);
}

function forbiddenSummaryPath(source: string): boolean {
  const method = summaryMethodBody(source);
  return (
    /getContextSummaries\(\):\s*ContextSummaryInfo\[\]/.test(method) ||
    /\b(?:materializeHistory|computeContextSummaries|\.materialize|Array\.fromAsync)\s*\(/.test(
      method,
    )
  );
}

describe('context summary return migration', () => {
  it('rejects the old array return and a deliberately materializing implementation', async () => {
    const source = await readFile(
      path.join(import.meta.dir, 'HistoryServiceCore.ts'),
      'utf8',
    );
    expect(
      forbiddenSummaryPath(
        'getContextSummaries(): ContextSummaryInfo[] { return []; }\n  /**',
      ),
    ).toBe(true);
    expect(
      forbiddenSummaryPath(
        'getContextSummaries(): AsyncIterable<ContextSummaryInfo> { return computeContextSummaries(this.materializeHistory()); }\n  /**',
      ),
    ).toBe(true);
    expect(forbiddenSummaryPath(source)).toBe(false);
    expect(summaryMethodBody(source)).toContain('this.journal.streamRows()');
  });

  it.each([512, 8192])(
    'matches the eager oracle for %i durable and pending rows, with one live owner',
    async (count) => {
      await withJournal(async (recording) => {
        const rows = Array.from({ length: count }, (_, i) =>
          row(i, i % 127 === 0 || i === count - 1),
        );
        const ownership = new RowOwnership();
        const read = createRowCounters();
        const service = new HistoryService({
          recording,
          attachmentCounters: { ...read.counters, ownership },
        });
        try {
          await service.replaceAll(rows.slice(0, -1));
          await service.waitForCommit();
          service.add(rows[rows.length - 1]);
          const actual: ContextSummaryInfo[] = [];
          for await (const summary of service.getContextSummaries())
            actual.push(summary);
          expect(actual).toStrictEqual(eagerOracle(rows));
          expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(1);
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(read.snapshot().peakDecodedRows).toBeLessThanOrEqual(1);
        } finally {
          service.dispose();
        }
      });
    },
  );
});

describe('context summary cancellation and resume', () => {
  it('releases a summary row after early break and explicit return', async () => {
    await withJournal(async (recording) => {
      const ownership = new RowOwnership();
      const read = createRowCounters();
      const service = new HistoryService({
        recording,
        attachmentCounters: { ...read.counters, ownership },
      });
      try {
        await service.replaceAll(
          Array.from({ length: 16 }, (_, i) => row(i, true)),
        );
        await service.waitForCommit();
        const iterator = service.getContextSummaries()[Symbol.asyncIterator]();
        expect((await iterator.next()).done).toBe(false);
        expect(ownership.snapshot().liveRows).toBe(1);
        await iterator.return?.();
        expect(ownership.snapshot().liveRows).toBe(0);
        for await (const summary of service.getContextSummaries()) {
          expect(summary.text).toContain('summary-');
          break;
        }
        expect(ownership.snapshot().liveRows).toBe(0);
        const failure = new Error('consumer stopped');
        await expect(
          (async () => {
            for await (const _summary of service.getContextSummaries()) {
              throw failure;
            }
          })(),
        ).rejects.toBe(failure);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(read.snapshot().peakDecodedRows).toBe(1);
      } finally {
        service.dispose();
      }
    });
  });
  it('projects compressed and continued rows after a real session resume', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'context-summary-resume-'),
    );
    const original = recorder(root);
    const summary = row(40, true);
    let resumed: Awaited<ReturnType<typeof resumeSession>> | undefined;
    try {
      for (let i = 0; i < 3; i++) original.recordContent(row(i));
      original.recordCompressed(summary, 3);
      original.recordContent(row(41));
      await original.flush();
      await original.dispose();
      resumed = await resumeSession({
        continueRef: 'context-summary-stream',
        projectHash: 'context-summary-stream',
        chatsDir: root,
        currentProvider: 'test',
        currentModel: 'test',
        workspaceDirs: [root],
      });
      if (!resumed.ok) throw new Error(resumed.error);
      const service = new HistoryService();
      try {
        await service.adoptResumeBoot(resumed.recording, resumed.boot);
        expect(
          await Array.fromAsync(service.getContextSummaries()),
        ).toStrictEqual(eagerOracle([summary, row(41)]));
      } finally {
        service.dispose();
      }
    } finally {
      if (resumed?.ok === true) {
        await resumed.recording.dispose();
        await resumed.lockHandle.release();
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
