import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from './HistoryService.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { MediaAdmissionService } from '../../storage/media-admission-service.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import {
  resumeSession,
  type ResumeResult,
} from '../../recording/resumeSession.js';

let root: string;

let store: LocalMediaStore;

let history: HistoryService;

let resumed: ResumeResult;

let oldReference: MediaReferenceBlock;

const inline: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    },
  ],
};

describe('resume media lifecycle', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'resume-media-'));
    store = new LocalMediaStore({
      rootDirectory: join(root, 'media'),
      quotaBytes: 1024 * 1024,
    });
    history = new HistoryService();
    history.registerMediaOwner(new HistoryMediaOwnership(store));
    const admission = new MediaAdmissionService(store);
    const context = { turnId: 'old', source: 'user-input' };
    const old = await admission.admitContents([inline], context);
    const reference = old[0].blocks[0];
    if (reference.type !== 'media' || reference.encoding !== 'reference')
      throw new Error('Missing reference');
    oldReference = reference;
    await admission.releaseContents(old, context);
    await history.replaceBatch(old);
    const recording = new SessionRecordingService({
      sessionId: 'next',
      projectHash: 'project',
      chatsDir: root,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'next' }],
    });
    await recording.flush();
    await recording.dispose();
    const result = await resumeSession({
      continueRef: 'next',
      chatsDir: root,
      projectHash: 'project',
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
      mediaStore: store,
    });
    if (!result.ok) throw new Error(result.error);
    resumed = result;
  });
  afterEach(async () => {
    history.dispose();
    await history.waitForOwnershipSettlement();
    await resumed.recording.dispose();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });

  it(
    'retains the previous real media reservation until publication commits',
    verifyRetainsThePreviousRealMediaReservationUntilPublicationCommits,
  );

  it(
    'releases the previous real reservation only after a successful switch',
    verifyReleasesThePreviousRealReservationOnlyAfterASuccessfulSwitch,
  );

  it(
    'keeps inline-media projections on adopted reads without releasing an existing live owner',
    verifyKeepsInlineMediaProjectionsOnAdoptedReadsWithoutReleasingAnExistingLive,
  );

  it(
    'reports committed retirement failure and leaves ownership available for disposal',
    verifyReportsCommittedRetirementFailureAndLeavesOwnershipAvailableForDisposal,
  );
});

async function verifyRetainsThePreviousRealMediaReservationUntilPublicationCommits(): Promise<void> {
  let retainedDuringPublication = false;
  await expect(
    history.adoptResumeBoot(resumed.recording, resumed.boot, async () => {
      retainedDuringPublication = await store.hasReservations(
        oldReference.contentId,
      );
      throw new Error('publication failure');
    }),
  ).rejects.toThrow('publication failure');
  expect(retainedDuringPublication).toBe(true);
  expect(await store.hasReservations(oldReference.contentId)).toBe(true);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows[0].blocks[0]).toStrictEqual(oldReference);
  });
}

async function verifyReleasesThePreviousRealReservationOnlyAfterASuccessfulSwitch(): Promise<void> {
  await history.adoptResumeBoot(resumed.recording, resumed.boot);
  expect(await store.hasReservations(oldReference.contentId)).toBe(false);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows[0].blocks).toStrictEqual([{ type: 'text', text: 'next' }]);
  });
}

async function verifyKeepsInlineMediaProjectionsOnAdoptedReadsWithoutReleasingAnExistingLive(): Promise<void> {
  await resumed.recording.dispose();
  const recording = new SessionRecordingService({
    sessionId: 'inline',
    projectHash: 'project',
    chatsDir: root,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  recording.recordContent(inline);
  await recording.flush();
  await recording.dispose();
  const result = await resumeSession({
    continueRef: 'inline',
    chatsDir: root,
    projectHash: 'project',
    currentProvider: 'test',
    currentModel: 'test',
    workspaceDirs: [],
    mediaStore: store,
  });
  if (!result.ok) throw new Error(result.error);
  resumed = result;
  await Array.fromAsync(result.boot.streamRows());
  expect(await store.hasReservations(oldReference.contentId)).toBe(true);
  await history.adoptResumeBoot(result.recording, result.boot);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows[0].blocks[0]).toStrictEqual(oldReference);
  });
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'after media' }],
  });
  await history.waitForCommit();
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows[0].blocks[0]).toStrictEqual(oldReference);
  });
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows[1].metadata?.chronology?.seq).toBe(2);
  });
}

async function verifyReportsCommittedRetirementFailureAndLeavesOwnershipAvailableForDisposal(): Promise<void> {
  const release = spyOn(store, 'release').mockRejectedValueOnce(
    new Error('release fault'),
  );
  try {
    const warnings = await history.adoptResumeBoot(
      resumed.recording,
      resumed.boot,
    );
    expect(warnings.join(' ')).toContain('release fault');
    expect(history.journalPath()).toBe(resumed.boot.filePath);
    expect(await store.hasReservations(oldReference.contentId)).toBe(true);
  } finally {
    release.mockRestore();
  }
  history.dispose();
  await history.waitForOwnershipSettlement();
  expect(await store.hasReservations(oldReference.contentId)).toBe(false);
}
