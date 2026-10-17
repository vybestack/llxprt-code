/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * The ephemeral child journal of a subagent on the journal backend. The cases
 * of `childJournalLifecycle.p05c.test.ts` keep their assertions; the write
 * failures are injected at the journal file instead of the JSONL append seam.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { JournalSessionOptions } from '../services/history/journalSession.js';
import {
  createJournalChildSession,
  type JournalChildSessionOptions,
} from './journalChildSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  userRow,
} from './__tests__/support/recordedJournals.js';

describe('child session journal on the journal backend', () => {
  const directory = useTempDir('journal-child-');
  const parents: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const parent of parents.splice(0)) {
      await parent.dispose().catch(() => undefined);
    }
  });

  function options(
    journal: JournalSessionOptions | undefined = journalSeams(),
  ): JournalChildSessionOptions {
    return {
      parentSessionId: randomUUID(),
      projectHash: PROJECT,
      chatsDir: chatsDirIn(directory()),
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'claude-4',
      ...(journal === undefined ? {} : { journal }),
    };
  }

  async function lockExists(): Promise<boolean> {
    const entries = await readdir(chatsDirIn(directory()));
    return entries.some((entry) => entry.endsWith('.lock'));
  }

  async function sessionFileCount(): Promise<number> {
    const entries = await readdir(chatsDirIn(directory()));
    return entries.filter((entry) => entry.startsWith('session-')).length;
  }

  it('materializes a locked child journal under its own file', async () => {
    const opts = options();
    const child = await createJournalChildSession(opts);
    await (await child.recording.session()).append([userRow('child work')]);
    await child.recording.flush();
    const filePath = child.recording.getFilePath();
    expect(filePath).not.toBeNull();
    expect(existsSync(filePath as string)).toBe(true);
    expect(
      await SessionLockManager.isLocked(opts.chatsDir, child.sessionId),
    ).toBe(true);
    await child.dispose();
  });

  it('stamps the subagent kind and the parent into the file the creation wrote', async () => {
    const opts = options();
    const child = await createJournalChildSession(opts);
    try {
      const facts = await readJournalFileFacts(
        child.recording.getFilePath() as string,
      );
      expect(facts?.facts.sessionId).toBe(child.sessionId);
      expect(facts?.facts.start.kind).toBe('subagent');
      expect(facts?.facts.start.parentSessionId).toBe(opts.parentSessionId);
    } finally {
      await child.dispose();
    }
  });

  it('uses the id the caller allocated', async () => {
    const child = await createJournalChildSession({
      ...options(),
      sessionId: 'allocated-before-runtime',
    });
    try {
      expect(child.sessionId).toBe('allocated-before-runtime');
      expect(child.recording.getSessionId()).toBe('allocated-before-runtime');
    } finally {
      await child.dispose();
    }
  });

  it('dispose removes the journal file and releases the lock', async () => {
    const opts = options();
    const child = await createJournalChildSession(opts);
    const { sessionId } = child;
    await child.dispose();
    expect(await SessionLockManager.isLocked(opts.chatsDir, sessionId)).toBe(
      false,
    );
    expect(await sessionFileCount()).toBe(0);
    expect(await lockExists()).toBe(false);
  });

  it('dispose is idempotent', async () => {
    const child = await createJournalChildSession(options());
    await child.dispose();
    await expect(child.dispose()).resolves.toBeUndefined();
  });

  it('an init failure leaves no journal or lock behind', async () => {
    const seams = testJournalSeams({ failWriteAt: 0 });
    let error: unknown = null;
    try {
      await createJournalChildSession(options({ journal: seams.dependencies }));
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(await sessionFileCount()).toBe(0);
    expect(await lockExists()).toBe(false);
  });

  it('a mid-life write failure still cleans up on dispose', async () => {
    const probe = testJournalSeams();
    const created = await createJournalChildSession(
      options({ journal: probe.dependencies }),
    );
    const writesToCreate = probe.events.filter(
      (e) => e.type === 'write',
    ).length;
    await created.dispose();

    const seams = testJournalSeams({ failWriteAt: writesToCreate });
    const child = await createJournalChildSession(
      options({ journal: seams.dependencies }),
    );
    child.recording.recordSessionMetadata('fails to write');
    await child.dispose();
    expect(await sessionFileCount()).toBe(0);
    expect(await lockExists()).toBe(false);
  });

  it('the parent journal stays one task group, isolated from children', async () => {
    const opts = options();
    const parent = await JournalRecordingService.createLocked({
      sessionId: randomUUID(),
      projectHash: PROJECT,
      chatsDir: opts.chatsDir,
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'claude-4',
      journal: journalSeams(),
    });
    parents.push(parent);
    await (await parent.session()).append([userRow('parent work')]);
    await parent.flush();
    const child = await createJournalChildSession(opts);
    await (await child.recording.session()).append([userRow('child work')]);
    await child.recording.flush();
    const parentPath = parent.getFilePath();
    expect(parentPath).not.toBeNull();
    const raw = await readFile(parentPath as string, 'utf8');
    expect(raw).not.toContain('child work');
    expect((await readJournalFileFacts(parentPath as string))?.rows).toBe(1);
    expect(child.recording.getFilePath()).not.toBe(parentPath);
    await child.dispose();
  });
});
