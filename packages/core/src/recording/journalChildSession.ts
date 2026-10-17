/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import type { JournalSessionOptions } from '../services/history/journalSession.js';
import { allocateChildSessionId } from './childSessionIds.js';
import { JournalRecordingService } from './journalRecordingService.js';

/** Inputs for {@link createJournalChildSession}. */
export interface JournalChildSessionOptions {
  /** Pre-allocated fs-safe id, when the caller minted one before runtime construction. */
  readonly sessionId?: string;
  /** Session id of the owning parent, stamped into the child's `session:start` fact. */
  readonly parentSessionId: string;
  readonly projectHash: string;
  readonly chatsDir: string;
  readonly workspaceDirs: readonly string[];
  readonly provider: string;
  readonly model: string;
  /** File seams of the journal (tests). */
  readonly journal?: JournalSessionOptions;
}

/** An ephemeral child journal whose dispose() removes every artifact. */
export interface JournalChildSession {
  /** The fs-safe id allocated for this child (== recording.getSessionId()). */
  readonly sessionId: string;
  readonly recording: JournalRecordingService;
  /**
   * Disposes the recorder, releases the lock and removes the journal file.
   * Idempotent; leaves no lock and no session file, even when writes failed.
   */
  dispose(): Promise<void>;
}

/**
 * The recorder is disposed first, which releases the lock even when its flush
 * failed; then the file is removed. A recorder whose creation failed has
 * already removed its partial file and has no path.
 */
async function cleanup(recording: JournalRecordingService): Promise<void> {
  try {
    await recording.dispose();
  } catch {
    // A flush failure must not block artifact removal.
  }
  const filePath = recording.getFilePath();
  if (filePath !== null) await fs.rm(filePath, { force: true });
}

/**
 * Allocates a child session id, creates the locked recorder under it with
 * `kind: 'subagent'` and the parent id, and writes the start group so a broken
 * file fails the creation instead of leaving an unreadable journal. Any
 * failure removes the lock and the partial file before rethrowing.
 */
export async function createJournalChildSession(
  options: JournalChildSessionOptions,
): Promise<JournalChildSession> {
  const sessionId = options.sessionId ?? allocateChildSessionId();
  const recording = await JournalRecordingService.createLocked({
    sessionId,
    projectHash: options.projectHash,
    chatsDir: options.chatsDir,
    workspaceDirs: [...options.workspaceDirs],
    provider: options.provider,
    model: options.model,
    kind: 'subagent',
    parentSessionId: options.parentSessionId,
    ...(options.journal === undefined ? {} : { journal: options.journal }),
  });
  try {
    await recording.session();
  } catch (error: unknown) {
    await cleanup(recording);
    throw error;
  }
  let disposed = false;
  return {
    sessionId,
    recording,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await cleanup(recording);
    },
  };
}
