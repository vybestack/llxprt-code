/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRecordedSession,
  PROJECT_HASH,
} from '../../recording/__tests__/support/p05dTestKit.js';
import {
  resumeSession,
  type ResumeResult,
} from '../../recording/resumeSession.js';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';

const harness = new FanoutHarness();
let root: string;
let resumed: ResumeResult | undefined;

async function resumedSession(): Promise<ResumeResult> {
  const fixture = await createRecordedSession(root, { rows: 3 });
  const result = await resumeSession({
    continueRef: fixture.sessionId,
    chatsDir: root,
    projectHash: PROJECT_HASH,
    currentProvider: 'anthropic',
    currentModel: 'claude-4',
    workspaceDirs: [],
  });
  if (!result.ok) throw new Error(result.error);
  resumed = result;
  return result;
}

describe('resuming one origin while another is mirrored', () => {
  beforeEach(async () => {
    await harness.setup();
    root = await mkdtemp(join(tmpdir(), 'fanout-resume-'));
  });
  afterEach(async () => {
    await resumed?.recording.dispose();
    resumed = undefined;
    await harness.teardown();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps the resumed recorder a filtered mirror of its own origin', async () => {
    const { service, ownerA, ownerB, b } = await harness.twoOrigins();
    service.add(textRow('A-before'), undefined, ownerA);
    service.add(textRow('B-before'), undefined, ownerB);
    await service.waitForCommit();

    const result = await resumedSession();
    await service.adoptResumeBoot(result.recording, result.boot, () =>
      service.attachJournal(result.recording, false, undefined, ownerA),
    );
    expect(service.journalPath()).not.toBe(result.boot.filePath);

    service.add(textRow('A-after'), undefined, ownerA);
    service.add(textRow('B-after'), undefined, ownerB);
    await service.waitForCommit();

    const shared = (await harness.shared(service)).map(rowText);
    expect(shared).toStrictEqual([
      'row-0',
      'row-1',
      'row-2',
      'A-after',
      'B-after',
    ]);
    expect(await harness.replayed(result.recording)).toStrictEqual([
      'row-0',
      'row-1',
      'row-2',
      'A-after',
    ]);
    expect(await harness.replayed(b)).toStrictEqual(['B-after']);
  });
});
