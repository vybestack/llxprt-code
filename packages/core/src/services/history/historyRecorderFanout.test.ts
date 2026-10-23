/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { journalRows } from '../../recording/__tests__/support/journal-read-test-helpers.js';
import { historyOriginId } from './historyOriginId.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

let dir: string;
const recorders: JournalRecordingService[] = [];
const histories: HistoryService[] = [];

let counter = 0;
function recorder(id: string): JournalRecordingService {
  const created = JournalRecordingService.create({
    sessionId: `fanout-${id}-${counter++}`,
    projectHash: 'fanout',
    chatsDir: dir,
    workspaceDirs: [dir],
    provider: 'test',
    model: 'test',
  });
  recorders.push(created);
  return created;
}

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function history(): HistoryService {
  const created = new HistoryService();
  histories.push(created);
  return created;
}

async function recorded(service: JournalRecordingService): Promise<string> {
  await service.flush();
  const path = service.getFilePath();
  return path === null ? '' : JSON.stringify(await journalRows(path));
}

describe('origin id', () => {
  it('is stable per object, distinct across objects and small', () => {
    const a = {};
    const b = {};
    expect(historyOriginId(a)).toBe(historyOriginId(a));
    expect(historyOriginId(a)).not.toBe(historyOriginId(b));
    expect(historyOriginId(a).length).toBeLessThanOrEqual(12);
  });
});

describe('history recorder fan-out', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fanout-'));
  });

  afterEach(async () => {
    for (const history of histories.splice(0)) await history.dispose();
    for (const recorder of recorders.splice(0)) await recorder.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  describe('per-origin journal fan-out in the history store', () => {
    async function shared() {
      const service = history();
      const ownerA = {};
      const ownerB = {};
      const a = recorder('a');
      const b = recorder('b');
      service.add(row('seed'));
      await service.attachJournal(a, true, undefined, ownerA);
      service.add(row('a-before-b'), undefined, ownerA);
      await service.waitForCommit();
      return { service, ownerA, ownerB, a, b };
    }

    it('keeps A recording when B attaches and seeds B with unowned rows only', async () => {
      const { service, ownerB, a, b } = await shared();
      let aRetired = false;
      service.onJournalRetired(() => {
        aRetired = true;
      });
      await service.attachJournal(b, true, undefined, ownerB);
      await service.waitForCommit();
      expect(aRetired).toBe(false);
      const fileB = await recorded(b);
      expect(fileB).toContain('seed');
      expect(fileB).not.toContain('a-before-b');
      expect(await recorded(a)).toContain('a-before-b');
    });

    it('fans out each origin to its own recording at publish time', async () => {
      const { service, ownerA, ownerB, a, b } = await shared();
      await service.attachJournal(b, true, undefined, ownerB);
      service.add(row('a-turn'), undefined, ownerA);
      service.add(row('b-turn'), undefined, ownerB);
      service.add(row('external-turn'));
      await service.waitForCommit();
      const fileA = await recorded(a);
      const fileB = await recorded(b);
      expect(fileA).toContain('a-turn');
      expect(fileA).toContain('external-turn');
      expect(fileA).not.toContain('b-turn');
      expect(fileB).toContain('b-turn');
      expect(fileB).toContain('external-turn');
      expect(fileB).not.toContain('a-turn');
    });

    it('keeps row order when a large batch is still being pumped to the mirror', async () => {
      const { service, ownerB, b } = await shared();
      await service.attachJournal(b, true, undefined, ownerB);
      const batch = Array.from({ length: 12 }, (_, index) =>
        row(`batch-${index}`),
      );
      const publishing = service.addBatch(batch, undefined, { origin: ownerB });
      service.add(row('after-batch'), undefined, ownerB);
      await publishing;
      await service.waitForCommit();
      const fileB = await recorded(b);
      const positions = [
        ...batch.map((_, index) => `batch-${index}`),
        'after-batch',
      ].map((text) => fileB.indexOf(text));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toStrictEqual([...positions].sort((x, y) => x - y));
    });

    it('re-attaching an origin replaces only that binding', async () => {
      const { service, ownerA, ownerB, a, b } = await shared();
      await service.attachJournal(b, true, undefined, ownerB);
      const a2 = recorder('a2');
      await service.attachJournal(a2, true, undefined, ownerA);
      service.add(row('a-after-restart'), undefined, ownerA);
      service.add(row('b-after-restart'), undefined, ownerB);
      await service.waitForCommit();
      expect(await recorded(a2)).toContain('a-after-restart');
      expect(await recorded(a2)).not.toContain('b-after-restart');
      expect(await recorded(b)).toContain('b-after-restart');
      expect(await recorded(a)).not.toContain('a-after-restart');
    });

    it('a failed publication reaches neither recording, not even its compensation', async () => {
      const { service, ownerA, ownerB, a, b } = await shared();
      await service.attachJournal(b, true, undefined, ownerB);
      await expect(
        service.addBatch([row('rolled-back')], undefined, {
          origin: ownerA,
          afterPublication: () => {
            throw new Error('reject');
          },
        }),
      ).rejects.toThrow('reject');
      service.add(row('survivor'), undefined, ownerA);
      await service.waitForCommit();
      const fileA = await recorded(a);
      const fileB = await recorded(b);
      for (const file of [fileA, fileB]) {
        expect(file).not.toContain('rolled-back');
      }
      expect(fileA).toContain('survivor');
      expect(fileB).not.toContain('survivor');
    });

    it('streams a large published batch to mirrors without staging ops', async () => {
      const { service, ownerA, ownerB, a, b } = await shared();
      await service.attachJournal(b, true, undefined, ownerB);
      const rows = Array.from({ length: 200 }, (_, index) =>
        row(`bulk-${index}`),
      );
      await service.addBatch(rows, undefined, { origin: ownerA });
      await service.waitForCommit();
      const fileA = await recorded(a);
      expect(fileA).toContain('bulk-0');
      expect(fileA).toContain('bulk-199');
      expect(await recorded(b)).not.toContain('bulk-');
    });

    it('treats rows from journals written before origins existed as unowned', async () => {
      const service = history();
      const a = recorder('a');
      const b = recorder('b');
      service.add(row('legacy-row'));
      await service.attachJournal(a, true, undefined, {});
      await service.attachJournal(b, true, undefined, {});
      expect(await recorded(b)).toContain('legacy-row');
    });
  });
});
