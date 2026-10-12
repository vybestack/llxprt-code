/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryRecorderFanout } from './historyRecorderFanout.js';
import { historyOriginId } from './historyOriginId.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

let dir: string;
const recorders: SessionRecordingService[] = [];
const histories: HistoryService[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fanout-'));
});

afterEach(async () => {
  for (const history of histories.splice(0)) history.dispose();
  for (const recorder of recorders.splice(0)) await recorder.dispose();
  await rm(dir, { recursive: true, force: true });
});

let counter = 0;
function recorder(id: string): SessionRecordingService {
  const created = new SessionRecordingService({
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

async function recorded(service: SessionRecordingService): Promise<string> {
  await service.flush();
  const path = service.getFilePath();
  return path === null ? '' : readFile(path, 'utf8');
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

describe('HistoryRecorderFanout', () => {
  it('delivers own and unowned rows and skips foreign rows per binding', async () => {
    const fanout = new HistoryRecorderFanout();
    const a = recorder('a');
    const b = recorder('b');
    fanout.bind('A', a);
    fanout.bind('B', b);
    const content = (text: string, origin?: string) => ({
      content: row(text),
      ...(origin === undefined ? {} : { origin }),
    });
    fanout.deliver('content', content('a-turn', 'A'));
    fanout.deliver('content', content('b-turn', 'B'));
    fanout.deliver('content', content('external'));
    const fileA = await recorded(a);
    const fileB = await recorded(b);
    expect(fileA).toContain('a-turn');
    expect(fileA).toContain('external');
    expect(fileA).not.toContain('b-turn');
    expect(fileB).toContain('b-turn');
    expect(fileB).toContain('external');
    expect(fileB).not.toContain('a-turn');
  });

  it('re-binding an origin replaces only that origin and unbind removes it', async () => {
    const fanout = new HistoryRecorderFanout();
    const a1 = recorder('a1');
    const a2 = recorder('a2');
    const b = recorder('b');
    fanout.bind('A', a1);
    fanout.bind('B', b);
    fanout.bind('A', a2);
    expect(fanout.size).toBe(2);
    expect(fanout.has(a1)).toBe(false);
    expect(fanout.unbind(b)).toBe(true);
    fanout.deliver('content', { content: row('after') });
    expect(await recorded(a2)).toContain('after');
    expect(await recorded(a1)).not.toContain('after');
    expect(await recorded(b)).not.toContain('after');
  });

  it('a failing binding does not starve the others and the failure is rethrown', async () => {
    const fanout = new HistoryRecorderFanout();
    const broken = recorder('broken');
    const healthy = recorder('healthy');
    await broken.dispose();
    fanout.bind('A', broken);
    fanout.bind('B', healthy);
    expect(() =>
      fanout.deliver('content', { content: row('shared') }),
    ).toThrow();
    expect(await recorded(healthy)).toContain('shared');
  });
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
    expect(fileA).not.toContain('"type":"rewind","payload":{"itemsRemoved":1');
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
