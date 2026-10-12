/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryRecorderFanout } from './historyRecorderFanout.js';
import { historyOriginId } from './historyOriginId.js';
import type { HistoryJournalOp } from './historyJournalStore.js';

let dir: string;
const recorders: SessionRecordingService[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fanout-'));
});

afterEach(async () => {
  for (const recorder of recorders.splice(0)) await recorder.dispose();
  await rm(dir, { recursive: true, force: true });
});

function recorder(id: string): SessionRecordingService {
  const created = new SessionRecordingService({
    sessionId: `fanout-${id}`,
    projectHash: 'fanout',
    chatsDir: dir,
    workspaceDirs: [dir],
    provider: 'test',
    model: 'test',
  });
  recorders.push(created);
  return created;
}

function content(text: string, origin?: string): HistoryJournalOp {
  return {
    kind: 'content',
    content: { speaker: 'human', blocks: [{ type: 'text', text }] },
    origin,
  };
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
  it('records own and unowned ops and skips foreign ops per binding', async () => {
    const fanout = new HistoryRecorderFanout();
    const a = recorder('a');
    const b = recorder('b');
    fanout.bind('A', a);
    fanout.bind('B', b);
    for (const op of [
      content('a-turn', 'A'),
      content('b-turn', 'B'),
      content('external'),
    ]) {
      fanout.stage(op);
    }
    fanout.commit();
    const fileA = await recorded(a);
    const fileB = await recorded(b);
    expect(fileA).toContain('a-turn');
    expect(fileA).toContain('external');
    expect(fileA).not.toContain('b-turn');
    expect(fileB).toContain('b-turn');
    expect(fileB).toContain('external');
    expect(fileB).not.toContain('a-turn');
  });

  it('persists the origin id on the recorded row', async () => {
    const fanout = new HistoryRecorderFanout();
    const a = recorder('a');
    fanout.bind('A', a);
    fanout.stage(content('tagged', 'A'));
    fanout.commit();
    expect(await recorded(a)).toContain('"origin":"A"');
  });

  it('discards staged effects so no binding observes a failed mutation', async () => {
    const fanout = new HistoryRecorderFanout();
    const a = recorder('a');
    const b = recorder('b');
    fanout.bind('A', a);
    fanout.bind('B', b);
    fanout.stage(content('rolled-back'));
    fanout.discard();
    fanout.commit();
    expect(await recorded(a)).not.toContain('rolled-back');
    expect(await recorded(b)).not.toContain('rolled-back');
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
    fanout.stage(content('after'));
    fanout.commit();
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
    fanout.stage(content('shared'));
    expect(() => fanout.commit()).toThrow();
    expect(await recorded(healthy)).toContain('shared');
  });
});
