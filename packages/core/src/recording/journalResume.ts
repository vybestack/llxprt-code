/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { applyResumeBoundary } from '../services/history/journalRowCodec.js';
import type {
  JournalSession,
  JournalSessionOptions,
  SessionRow,
} from '../services/history/journalSession.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import { CONTINUE_LATEST } from './continueLatest.js';
import { listJournalSessions } from './journalSessionListing.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from './SessionLockManager.js';
import { readSessionFacts } from './sessionMetaKeys.js';
import {
  matchUnreadableRecordings,
  noReadableSessionsError,
} from './unreadableRecordings.js';
import type {
  SessionMetadata,
  SessionSummary,
  UnreadableRecording,
} from './types.js';

export interface JournalResumeRequest {
  continueRef: string;
  projectHash: string;
  chatsDir: string;
  currentProvider: string;
  currentModel: string;
  workspaceDirs: string[];
  /** File seams and the occurrence planner of the journal (tests, phase 5). */
  journal?: JournalSessionOptions;
}

/** The version a resumed journal was opened on. */
export interface ResumePoint {
  readonly commitSeq: number;
  readonly rows: number;
  /** Rows with a label below this were written by an earlier process. */
  readonly nextLabel: bigint;
}

export interface JournalResumeResult {
  ok: true;
  recording: JournalRecordingService;
  metadata: SessionMetadata;
  lockHandle: LockHandle;
  resumePoint: ResumePoint;
  /** Recordings in the project that could not be read and were passed over. */
  skippedRecordings: readonly UnreadableRecording[];
}

export interface JournalResumeError {
  ok: false;
  error: string;
  skippedRecordings: readonly UnreadableRecording[];
}

type Booted = Omit<JournalResumeResult, 'skippedRecordings'>;
type BootFailure = { ok: false; reason: string };

/** Acquires the session lock; null only when another process holds it. */
async function tryLock(
  chatsDir: string,
  sessionId: string,
): Promise<LockHandle | null> {
  try {
    return await SessionLockManager.acquire(chatsDir, sessionId);
  } catch (error: unknown) {
    if (error instanceof SessionLockedError) return null;
    throw error;
  }
}

function recordingConfig(
  request: JournalResumeRequest,
  session: SessionSummary,
): JournalRecordingConfig {
  return {
    sessionId: session.sessionId,
    projectHash: request.projectHash,
    chatsDir: request.chatsDir,
    workspaceDirs: request.workspaceDirs,
    provider: request.currentProvider,
    model: request.currentModel,
    ...(request.journal === undefined ? {} : { journal: request.journal }),
  };
}

async function describeOpened(
  recording: JournalRecordingService,
): Promise<Pick<Booted, 'metadata' | 'resumePoint'>> {
  const { store } = await recording.session();
  const facts = await readSessionFacts((key) => store.getState(key));
  if (facts === undefined) {
    throw new Error(`Session file ${store.path} holds no committed session`);
  }
  const published = store.published;
  return {
    metadata: {
      sessionId: facts.sessionId,
      projectHash: facts.start.projectHash,
      provider: facts.provider,
      model: facts.model,
      workspaceDirs: facts.directories,
      startTime: facts.start.startTime,
      kind: facts.start.kind,
      ...(facts.start.cwd === undefined ? {} : { cwd: facts.start.cwd }),
      ...(facts.start.parentSessionId === undefined
        ? {}
        : { parentSessionId: facts.start.parentSessionId }),
      ...(facts.title === undefined ? {} : { title: facts.title }),
    },
    resumePoint: {
      commitSeq: published?.commitSeq ?? 0,
      rows: published?.rows ?? 0,
      nextLabel: published?.nextLabel ?? 1n,
    },
  };
}

/**
 * Opens the journal of a locked session. On failure the lock is released and
 * the reason is returned, so one session that cannot be opened never blocks
 * the others.
 */
async function bootLocked(
  request: JournalResumeRequest,
  session: SessionSummary,
  lockHandle: LockHandle,
): Promise<Booted | BootFailure> {
  let recording: JournalRecordingService;
  try {
    recording = await JournalRecordingService.open(
      recordingConfig(request, session),
      session.filePath,
    );
  } catch (error) {
    await lockHandle.release();
    return failure(error);
  }
  // From here the recorder owns the lock and disposing it releases it.
  recording.adoptLock(lockHandle);
  try {
    const described = await describeOpened(recording);
    noteProviderChange(recording, request, described.metadata);
    return { ok: true, recording, lockHandle, ...described };
  } catch (error) {
    await recording.dispose();
    return failure(error);
  }
}

function failure(error: unknown): BootFailure {
  return {
    ok: false,
    reason: error instanceof Error ? error.message : String(error),
  };
}

/** Records a provider/model change and the resume itself, as the JSONL resume did. */
function noteProviderChange(
  recording: JournalRecordingService,
  request: JournalResumeRequest,
  metadata: SessionMetadata,
): void {
  if (
    request.currentProvider !== metadata.provider ||
    request.currentModel !== metadata.model
  ) {
    recording.recordSessionEvent(
      'warning',
      `Provider/model changed from ${metadata.provider}/${metadata.model} to ${request.currentProvider}/${request.currentModel}`,
    );
    recording.recordProviderSwitch(
      request.currentProvider,
      request.currentModel,
    );
  }
  recording.recordSessionEvent(
    'info',
    `Session resumed (originally started ${metadata.startTime})`,
  );
}

/** Bare continue: the newest unlocked session that opens; failures are skipped and reported. */
async function bootNewest(
  request: JournalResumeRequest,
  sessions: SessionSummary[],
  skipped: UnreadableRecording[],
): Promise<Booted | { ok: false; error: string }> {
  let firstFailure: string | undefined;
  let sawLocked = false;
  for (const session of sessions) {
    const lockHandle = await tryLock(request.chatsDir, session.sessionId);
    if (lockHandle === null) {
      sawLocked = true;
      continue;
    }
    const booted = await bootLocked(request, session, lockHandle);
    if (booted.ok) return booted;
    skipped.push({
      sessionId: session.sessionId,
      filePath: session.filePath,
      reason: booted.reason,
    });
    firstFailure ??= booted.reason;
  }
  if (firstFailure !== undefined) {
    return { ok: false, error: `Failed to replay session: ${firstFailure}` };
  }
  return {
    ok: false,
    error: sawLocked
      ? 'All sessions for this project are in use'
      : noReadableSessionsError(skipped),
  };
}

async function bootReferenced(
  request: JournalResumeRequest,
  sessions: SessionSummary[],
  unreadable: readonly UnreadableRecording[],
): Promise<Booted | { ok: false; error: string }> {
  const resolved = SessionDiscovery.resolveSessionRef(
    request.continueRef,
    sessions,
  );
  if ('error' in resolved) {
    const named = matchUnreadableRecordings(
      request.continueRef,
      resolved.error,
      unreadable,
    );
    return {
      ok: false,
      error:
        named.length === 0
          ? resolved.error
          : named.map((recording) => recording.reason).join('; '),
    };
  }
  const { session } = resolved;
  const lockHandle = await tryLock(request.chatsDir, session.sessionId);
  if (lockHandle === null) {
    return { ok: false, error: 'Session is in use by another process' };
  }
  const booted = await bootLocked(request, session, lockHandle);
  return booted.ok
    ? booted
    : { ok: false, error: `Failed to replay session: ${booted.reason}` };
}

/**
 * Resumes a recorded session on the journal: discovers the project's
 * sessions, resolves the reference, takes the lock and opens the journal for
 * its owner. No row is read; the history is the row tree of the opened file,
 * read through {@link resumedRows}. A file in the retired JSONL format is
 * listed as unreadable with the single refusal message and never opened.
 */
export async function resumeJournalSession(
  request: JournalResumeRequest,
): Promise<JournalResumeResult | JournalResumeError> {
  const { sessions, unreadableRecordings } = await listJournalSessions(
    request.chatsDir,
    request.projectHash,
  );
  const skipped = [...unreadableRecordings];
  if (sessions.length === 0 && request.continueRef === CONTINUE_LATEST) {
    return {
      ok: false,
      error: noReadableSessionsError(skipped),
      skippedRecordings: skipped,
    };
  }
  const outcome =
    request.continueRef === CONTINUE_LATEST
      ? await bootNewest(request, sessions, skipped)
      : await bootReferenced(request, sessions, unreadableRecordings);
  return { ...outcome, skippedRecordings: skipped };
}

/**
 * The history of a resumed session, one decoded row at a time. A row written
 * by an earlier process loses its stored Responses chain marker, because the
 * chain belongs to the process that made the request; a row written after the
 * resume keeps it. The flag is not stored on the row: rows are immutable and
 * the boundary is the version this process opened.
 */
export async function* resumedRows(
  session: JournalSession,
  resumePoint: ResumePoint,
): AsyncGenerator<SessionRow> {
  for await (const row of session.rows()) {
    yield {
      entry: row.entry,
      content: applyResumeBoundary(
        row.entry.label,
        row.content,
        resumePoint.nextLabel,
      ),
    };
  }
}
