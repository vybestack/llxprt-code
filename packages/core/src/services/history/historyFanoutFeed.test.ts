/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryFanoutFeed } from './historyFanoutFeed.js';
import { HistoryRecorderFanout } from './historyRecorderFanout.js';
import type { IContent } from './IContent.js';

let dir: string;
const recorders: SessionRecordingService[] = [];
let counter = 0;

function recorder(id: string): SessionRecordingService {
  const created = new SessionRecordingService({
    sessionId: `feed-${id}-${counter++}`,
    projectHash: 'feed',
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

async function recorded(service: SessionRecordingService): Promise<string> {
  await service.flush();
  const path = service.getFilePath();
  return path === null ? '' : readFile(path, 'utf8');
}

function enqueueContent(
  primary: SessionRecordingService,
  text: string,
  origin: string,
): number {
  const line = primary.enqueue('content', { content: row(text), origin });
  if (line === null) throw new Error('primary refused a record');
  return line.seq;
}

describe('history fan-out feed bounds', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fanout-feed-'));
  });

  afterEach(async () => {
    for (const created of recorders.splice(0)) await created.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  async function fixture() {
    const fanout = new HistoryRecorderFanout();
    const feed = new HistoryFanoutFeed(fanout);
    const primary = recorder('primary');
    const mirror = recorder('mirror');
    fanout.bind('A', mirror);
    fanout.active = true;
    const seed = enqueueContent(primary, 'seed', 'A');
    await primary.waitForCommitSequence(seed);
    const path = primary.getFilePath();
    if (path === null) throw new Error('primary was not materialized');
    feed.reset(primary, (await stat(path)).size);
    return { feed, primary, mirror };
  }

  it('delivers exactly the records up to the requested sequence when later ones are already acknowledged', async () => {
    const { feed, primary, mirror } = await fixture();
    const seqs = ['c1', 'c2', 'c3', 'c4', 'c5'].map((text) =>
      enqueueContent(primary, text, 'A'),
    );
    await primary.waitForCommitSequence(seqs[4]);
    feed.schedule(primary, seqs[1], 'deliver');
    await feed.settle();
    const first = await recorded(mirror);
    expect(first).toContain('c1');
    expect(first).toContain('c2');
    for (const later of ['c3', 'c4', 'c5']) expect(first).not.toContain(later);
    feed.schedule(primary, seqs[4], 'deliver');
    await feed.settle();
    const second = await recorded(mirror);
    for (const text of ['c1', 'c2', 'c3', 'c4', 'c5'])
      expect(second.split(`"text":"${text}"`).length - 1).toBe(1);
  });

  it('does not deliver rolled-back records that follow an earlier acknowledged one', async () => {
    const { feed, primary, mirror } = await fixture();
    const kept = enqueueContent(primary, 'kept', 'A');
    const rolledBack = enqueueContent(primary, 'rolled-back', 'A');
    const survivor = enqueueContent(primary, 'survivor', 'A');
    await primary.waitForCommitSequence(survivor);
    feed.schedule(primary, kept, 'deliver');
    feed.schedule(primary, rolledBack, 'drop');
    feed.schedule(primary, survivor, 'deliver');
    await feed.settle();
    const file = await recorded(mirror);
    expect(file).toContain('kept');
    expect(file).toContain('survivor');
    expect(file).not.toContain('rolled-back');
  });

  it('does not skip a successful record that follows a skipped one', async () => {
    const { feed, primary, mirror } = await fixture();
    const rolledBack = enqueueContent(primary, 'rolled-back', 'A');
    const survivor = enqueueContent(primary, 'survivor', 'A');
    await primary.waitForCommitSequence(survivor);
    feed.schedule(primary, rolledBack, 'drop');
    feed.schedule(primary, survivor, 'deliver');
    await feed.settle();
    const file = await recorded(mirror);
    expect(file).toContain('survivor');
    expect(file).not.toContain('rolled-back');
  });
});
