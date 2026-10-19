/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { TRAILER_RECORD_BYTES } from '../journal/trailerRecord.js';
import type { IContent } from '../services/history/IContent.js';
import {
  nativeText,
  useNativeIntegration,
  type NativeIntegrationFixture,
} from './__tests__/support/native-integration-fixture.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { JournalResumeBoot, resumePointOf } from './journalResume.js';
import { withResumed } from './__tests__/support/native-resume-fixture.js';

function writeCount(fixture: NativeIntegrationFixture): number {
  return fixture.seams.events.filter((event) => event.type === 'write').length;
}

async function waitForHeldWrite(
  fixture: NativeIntegrationFixture,
): Promise<void> {
  const index = fixture.failures.gateWriteAt;
  if (index === undefined) throw new Error('Missing positional write gate');
  while (writeCount(fixture) <= index)
    await new Promise<void>((resolve) => setImmediate(resolve));
  expect(
    fixture.seams.events.filter((event) => event.type === 'write')[index],
  ).toMatchObject({ length: TRAILER_RECORD_BYTES });
}

function toolTurn(name: string): IContent[] {
  return [
    nativeText(`${name}-question`),
    {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: name, name: 'search', parameters: { name } },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: name,
          toolName: 'search',
          result: { name },
        },
      ],
    },
  ];
}

describe('native compression and replacement recording boundaries', () => {
  const fixture = useNativeIntegration();

  it('keeps a wholesale tool-history rebuild value-identical without duplicates', async () => {
    const { history, integration, recorded } = fixture();
    await integration.subscribeToJournal(history);
    const turn = toolTurn('original');
    for (const row of turn) history.add(row);
    await integration.flushAtTurnBoundary();
    await history.replaceAll(await collectRawHistory(history));
    await integration.flushAtTurnBoundary();
    expect(await recorded()).toStrictEqual(toolTurn('original'));
  });

  it('keeps a changed payload even when it reuses a chronology marker', async () => {
    const { history, integration, recorded } = fixture();
    await integration.subscribeToJournal(history);
    history.add(nativeText('first'));
    await history.waitForCommit();
    const original = (await collectRawHistory(history))[0];
    history.add({
      ...nativeText('condensed replacement', 'ai'),
      metadata: original.metadata,
    });
    await integration.flushAtTurnBoundary();
    expect(await recorded()).toStrictEqual([
      nativeText('first'),
      nativeText('condensed replacement', 'ai'),
    ]);
  });

  it('keeps only the summary and new complete tool turn after compression and retry rebuild', async () => {
    const { history, integration, recorded } = fixture();
    await integration.subscribeToJournal(history);
    await history.addBatch(toolTurn('original'));
    history.startCompression();
    await history.replaceAll([nativeText('retry summary', 'ai')]);
    history.endCompression(nativeText('retry summary', 'ai'), 3);
    await history.replaceAll(await collectRawHistory(history));
    const retry = toolTurn('retry');
    for (const row of retry) history.add(row);
    await integration.flushAtTurnBoundary();
    expect(await recorded()).toStrictEqual([
      nativeText('retry summary', 'ai'),
      ...toolTurn('retry'),
    ]);
  });

  for (const primary of [false, true]) {
    for (const operation of ['replace', 'clear'] as const) {
      it(`holds the ${operation} turn boundary and FIFO additions behind the ${primary ? 'primary' : 'mirror'} trailer acknowledgement`, async () => {
        const current = fixture();
        const { history, integration, recording, failures, seams, texts } =
          current;
        if (primary) {
          await history.adoptResumeBoot(
            recording,
            new JournalResumeBoot(recording, await resumePointOf(recording)),
          );
        }
        await integration.subscribeToJournal(history);
        history.add(nativeText('baseline'));
        await integration.flushAtTurnBoundary();
        failures.gateWriteAt =
          writeCount(current) + (primary && operation === 'clear' ? 0 : 1);
        let settled = false;
        const mutation = (
          operation === 'replace'
            ? history.replaceAll([nativeText('replacement', 'ai')])
            : history.clear()
        ).then(() => {
          settled = true;
        });
        history.add(nativeText('queued-after-mutation'));
        let crossedBoundary = false;
        const boundary = integration.flushAtTurnBoundary().then(() => {
          crossedBoundary = true;
        });
        try {
          await waitForHeldWrite(current);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(primary && settled).toBe(false);
          expect(crossedBoundary).toBe(false);
          expect(await texts()).toStrictEqual(['baseline']);
        } finally {
          seams.release();
        }
        await mutation;
        await boundary;
        expect(await texts()).toStrictEqual([
          ...(operation === 'replace' ? ['replacement'] : []),
          'queued-after-mutation',
        ]);
      });
    }
  }

  it('serializes recorder metadata and service additions outside a held replacement group', async () => {
    const current = fixture();
    const { history, integration, recording, failures, seams, texts } = current;
    await integration.subscribeToJournal(history);
    history.add(nativeText('baseline'));
    await integration.flushAtTurnBoundary();
    failures.gateWriteAt = writeCount(current) + 1;
    const replacing = history.replaceAll([
      nativeText('replacement-1'),
      nativeText('replacement-2', 'ai'),
    ]);
    try {
      await waitForHeldWrite(current);
      integration.recordProviderSwitch('next-provider', 'next-model');
      recording.recordSessionMetadata('during replacement');
      history.add(nativeText('after replacement'));
      expect(await texts()).toStrictEqual(['baseline']);
    } finally {
      seams.release();
    }
    await replacing;
    await integration.flushAtTurnBoundary();
    expect(await texts()).toStrictEqual([
      'replacement-1',
      'replacement-2',
      'after replacement',
    ]);
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing native recording');
    expect(await readJournalFileFacts(file)).toMatchObject({
      rows: 3,
      facts: {
        provider: 'next-provider',
        model: 'next-model',
        title: 'during replacement',
      },
    });
  });

  it('finishes detaching admitted writes before a replacement history attaches', async () => {
    const current = fixture();
    const { history, integration, histories, failures, seams, texts } = current;
    const replacement = new HistoryService({ backend: 'journal' });
    histories.push(replacement);
    await integration.subscribeToJournal(history);
    history.add(nativeText('baseline'));
    await integration.flushAtTurnBoundary();
    await replacement.addBatch([
      nativeText('second-user'),
      nativeText('second-ai', 'ai'),
    ]);
    failures.gateWriteAt = writeCount(current) + 1;
    history.add(nativeText('admitted-first'));
    let attached = false;
    const handover = integration.subscribeToJournal(replacement).then(() => {
      attached = true;
    });
    try {
      await waitForHeldWrite(current);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(attached).toBe(false);
      expect(await texts()).toStrictEqual(['baseline']);
    } finally {
      seams.release();
    }
    await handover;
    history.add(nativeText('detached-first'));
    replacement.add(nativeText('second-tail'));
    await integration.flushAtTurnBoundary();
    await history.waitForCommit();
    expect(await texts()).toStrictEqual([
      'second-user',
      'second-ai',
      'second-tail',
    ]);
  });

  for (const operation of ['replace', 'clear'] as const) {
    it(`compensates ${operation} after publication rejection and keeps the mirror usable`, async () => {
      const { history, integration, texts } = fixture();
      await integration.subscribeToJournal(history);
      await history.addBatch([
        nativeText('baseline-1'),
        nativeText('baseline-2', 'ai'),
      ]);
      await integration.flushAtTurnBoundary();
      const beforeTokens = history.getTotalTokens();
      const failure = new Error(`${operation} publication rejected`);
      const reject = (): void => {
        history.off('tokensUpdated', reject);
        throw failure;
      };
      history.on('tokensUpdated', reject);
      await expect(
        operation === 'replace'
          ? history.replaceAll([nativeText('rejected')])
          : history.clear(),
      ).rejects.toBe(failure);
      await integration.flushAtTurnBoundary();
      expect(await texts()).toStrictEqual(['baseline-1', 'baseline-2']);
      expect(beforeTokens).toBeGreaterThan(0);
      expect(history.getTotalTokens() - beforeTokens).toBe(0);
      expect(history.getContextRange().totalEntries).toBe(2);
      history.add(nativeText('after rollback'));
      await integration.flushAtTurnBoundary();
      expect(await texts()).toStrictEqual([
        'baseline-1',
        'baseline-2',
        'after rollback',
      ]);
    });
  }

  for (const stage of ['records', 'trailer', 'flush'] as const) {
    it(`leaves the prior complete version readable after a primary replacement fails at ${stage}`, async () => {
      const current = fixture();
      const { history, recording, integration, failures, seams, texts } =
        current;
      await history.adoptResumeBoot(
        recording,
        new JournalResumeBoot(recording, await resumePointOf(recording)),
      );
      await integration.subscribeToJournal(history);
      await history.addBatch([
        nativeText('baseline-1'),
        nativeText('baseline-2', 'ai'),
      ]);
      await integration.flushAtTurnBoundary();
      const beforeTokens = history.getTotalTokens();
      if (stage === 'flush')
        failures.failFlushAt = seams.events.filter(
          (event) => event.type === 'flush',
        ).length;
      else
        failures.failWriteAt =
          writeCount(current) + (stage === 'trailer' ? 1 : 0);
      await expect(
        history.replaceAll([nativeText('rejected replacement')]),
      ).rejects.toThrow(
        `injected ${stage === 'flush' ? 'flush' : 'write'} failure`,
      );
      await integration.flushAtTurnBoundary();
      expect(await texts()).toStrictEqual(['baseline-1', 'baseline-2']);
      expect(beforeTokens).toBeGreaterThan(0);
      expect(history.getTotalTokens() - beforeTokens).toBe(0);
      expect(history.getContextRange().totalEntries).toBe(2);
      await withResumed(
        current,
        async (_resumed, reopened, resumedIntegration) => {
          reopened.add(nativeText('after failed replacement'));
          await resumedIntegration.flushAtTurnBoundary();
          expect(await texts()).toStrictEqual([
            'baseline-1',
            'baseline-2',
            'after failed replacement',
          ]);
        },
      );
    });
  }
});
