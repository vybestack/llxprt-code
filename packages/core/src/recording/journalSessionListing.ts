/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { sha256KeyHash } from '../journal/idKeys.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { checkpointsOf, stateReaderOf } from '../journal/journalReaderState.js';
import {
  RETIRED_SESSION_EXTENSION,
  SESSION_FILE_EXTENSION,
} from './sessionFileExtension.js';
import {
  SESSION_KEYS,
  decodePreviewFact,
  readSessionFacts,
  type SessionFacts,
} from './sessionMetaKeys.js';
import type {
  SessionStartPayload,
  SessionSummary,
  UnreadableRecording,
} from './types.js';

export interface JournalSessionListing {
  /** Sessions of the project, newest first. */
  readonly sessions: SessionSummary[];
  /** Files that were passed over, with the reason. */
  readonly unreadableRecordings: UnreadableRecording[];
}

const SESSION_FILE = /^session-.+/;

function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What discovery shows of one journal file: its session facts, preview and row count. No row is read. */
export interface JournalFileFacts {
  readonly facts: SessionFacts;
  readonly preview?: string;
  readonly rows: number;
  readonly fileSize: number;
}

/**
 * Reads the session facts of one journal file through a read-only view: the
 * header, the last trailer and a few state map entries. Undefined when the
 * file holds no committed session.
 */
export async function readJournalFileFacts(
  filePath: string,
): Promise<JournalFileFacts | undefined> {
  const reader = await openJournalReadOnly(filePath);
  try {
    const read = stateReaderOf(reader, sha256KeyHash);
    const facts = await readSessionFacts(read);
    if (facts === undefined) return undefined;
    const preview = await read(SESSION_KEYS.preview);
    return {
      facts,
      ...(preview === undefined ? {} : { preview: decodePreviewFact(preview) }),
      rows: reader.trailer?.rootAggregate.rows ?? 0,
      fileSize: reader.fileSize,
    };
  } finally {
    await reader.close();
  }
}

/** A live checkpoint of one journal file, as continue targets list it (design 4.9). */
export interface JournalCheckpointFact {
  readonly checkpointId: string;
  readonly name: string;
  /** The `commitSeq` of the version the checkpoint names. */
  readonly sequence: number;
  readonly createdAtMs: number;
}

/** The live checkpoints of one journal file, from its last trailer's state map; no row is read. */
export async function readJournalCheckpoints(
  filePath: string,
): Promise<readonly JournalCheckpointFact[]> {
  const reader = await openJournalReadOnly(filePath);
  try {
    const found: JournalCheckpointFact[] = [];
    for await (const { id, descriptor } of checkpointsOf(reader)) {
      found.push({
        checkpointId: id,
        name: descriptor.name,
        sequence: descriptor.commitSeq,
        createdAtMs: descriptor.createdAtMs,
      });
    }
    return found;
  } finally {
    await reader.close();
  }
}

/**
 * The header of one journal file as the `session_start` payload that the
 * JSONL header reader returns, built from the session facts. Null for a file
 * that is not a journal (a retired `.jsonl` file is never opened), holds no
 * committed session, or cannot be read: the file is external input and a
 * header reader answers "no header" for all of those.
 */
export async function readJournalSessionHeader(
  filePath: string,
): Promise<SessionStartPayload | null> {
  if (!filePath.endsWith(SESSION_FILE_EXTENSION)) return null;
  const found = await readJournalFileFacts(filePath).catch(() => undefined);
  if (found === undefined) return null;
  const { facts } = found;
  const { start } = facts;
  return {
    sessionId: facts.sessionId,
    projectHash: start.projectHash,
    workspaceDirs: start.workspaceDirs,
    ...(start.cwd === undefined ? {} : { cwd: start.cwd }),
    provider: facts.provider,
    model: facts.model,
    startTime: start.startTime,
    kind: start.kind,
    ...(start.parentSessionId === undefined
      ? {}
      : { parentSessionId: start.parentSessionId }),
  };
}

/** The summary of one journal file, or the reason the file cannot be listed. */
async function summarize(
  filePath: string,
): Promise<SessionSummary | UnreadableRecording> {
  const found = await readJournalFileFacts(filePath);
  if (found === undefined) {
    return {
      filePath,
      reason: `Session file ${filePath} holds no committed session`,
    };
  }
  const { facts } = found;
  const stats = await fsp.stat(filePath);
  return {
    sessionId: facts.sessionId,
    filePath,
    projectHash: facts.start.projectHash,
    startTime: facts.start.startTime,
    createdAt: facts.start.startTime,
    lastModified: stats.mtime,
    fileSize: found.fileSize,
    provider: facts.provider,
    model: facts.model,
    kind: facts.start.kind,
    messageCount: found.rows,
    ...(found.preview === undefined ? {} : { preview: found.preview }),
    ...(facts.start.cwd === undefined ? {} : { cwd: facts.start.cwd }),
    ...(facts.title === undefined ? {} : { title: facts.title }),
    ...(facts.name === undefined ? {} : { name: facts.name }),
  };
}

function isSummary(
  value: SessionSummary | UnreadableRecording,
): value is SessionSummary {
  return 'sessionId' in value && 'projectHash' in value;
}

function newestFirst(sessions: SessionSummary[]): void {
  sessions.sort((a, b) => {
    const mtimeDiff = b.lastModified.getTime() - a.lastModified.getTime();
    return mtimeDiff !== 0 ? mtimeDiff : b.sessionId.localeCompare(a.sessionId);
  });
}

/**
 * The sessions of a project in a chats directory. A file that cannot be read
 * never stops the listing: it is reported with its reason. A retired JSONL
 * file is reported with the single refusal message (design 2.1) without being
 * opened; a missing directory holds no sessions.
 */
export async function listJournalSessions(
  chatsDir: string,
  projectHash: string,
): Promise<JournalSessionListing> {
  let names: string[];
  try {
    names = await fsp.readdir(chatsDir);
  } catch (error) {
    if (isMissing(error)) return { sessions: [], unreadableRecordings: [] };
    throw error;
  }
  const sessions: SessionSummary[] = [];
  const unreadableRecordings: UnreadableRecording[] = [];
  for (const name of names.filter((n) => SESSION_FILE.test(n)).sort()) {
    const filePath = path.join(chatsDir, name);
    if (name.endsWith(RETIRED_SESSION_EXTENSION)) {
      unreadableRecordings.push({
        filePath,
        reason: retiredJournalMessage(filePath),
      });
    } else if (name.endsWith(SESSION_FILE_EXTENSION)) {
      const listed = await summarize(filePath).catch(
        (error: unknown): UnreadableRecording => ({
          filePath,
          reason: reasonOf(error),
        }),
      );
      if (!isSummary(listed)) unreadableRecordings.push(listed);
      else if (listed.projectHash === projectHash && listed.kind !== 'subagent')
        sessions.push(listed);
    }
  }
  newestFirst(sessions);
  return { sessions, unreadableRecordings };
}
