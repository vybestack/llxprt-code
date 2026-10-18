/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { StateReader } from '../journal/journalReaderState.js';
import { ownedString } from '../utils/ownedString.js';
import type { SessionStartKind } from './types.js';

/**
 * State map keys of the session facts the journal recorder writes (design 3.5,
 * decision G6). They live in the unversioned state map, so a pop keeps them,
 * and discovery reads them without touching any row.
 */
export const SESSION_KEYS = {
  id: 'session:id',
  /** `{startTime, projectHash, workspaceDirs, cwd?, kind, parentSessionId?}`. */
  start: 'session:start',
  /** A string, or null for an explicit untitled session. Absent: never set. */
  title: 'session:title',
  /** The mutable session name: a string, or null once cleared. */
  name: 'session:name',
  /** `{provider, model}`. */
  provider: 'session:provider',
  /** The current workspace directories: a string array. */
  directories: 'session:directories',
  /** The ancestry of a forked child: `SessionForkedPayload`. */
  fork: 'session:fork',
  /** The first user message, cut to {@link SESSION_PREVIEW_LENGTH}; written once (decision G7). */
  preview: 'session:preview',
} as const;

/** Characters of the first user message that discovery shows (decision G7). */
export const SESSION_PREVIEW_LENGTH = 200;

/**
 * The text a content row offers as the session preview: its text blocks, cut to the preview length. Undefined for a row that is not from the user or has no text.
 *
 * Only the leading preview-length characters of a block are read. A `slice` of a long string shares the parent's characters, so the cut goes through `ownedString`; otherwise the preview would keep the whole row alive for as long as the store holds it.
 */
export function previewOfContent(content: {
  readonly speaker: string;
  readonly blocks: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
}): string | undefined {
  if (content.speaker !== 'human') return undefined;
  let cut = '';
  for (const block of content.blocks) {
    if (cut.length >= SESSION_PREVIEW_LENGTH) break;
    if (block.type === 'text' && block.text !== undefined) {
      cut += block.text.slice(0, SESSION_PREVIEW_LENGTH - cut.length);
    }
  }
  return cut.length === 0 ? undefined : ownedString(cut);
}

/** The text a `session:preview` entry holds. */
export function decodePreviewFact(bytes: Uint8Array): string {
  const fact = decodeSessionFact(bytes);
  if (typeof fact !== 'string') throw malformed(SESSION_KEYS.preview);
  return fact;
}

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/** A session fact as the bytes of a state map value. */
export function encodeSessionFact(value: unknown): Uint8Array {
  return UTF8.encode(JSON.stringify(value));
}

/** The JSON value a state map entry holds. */
export function decodeSessionFact(bytes: Uint8Array): unknown {
  return JSON.parse(UTF8_DECODER.decode(bytes));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(key: string): Error {
  return new Error(`Session fact ${key} is not in the expected form`);
}

/** The `{provider, model}` a `session:provider` entry holds. */
export function decodeProviderFact(bytes: Uint8Array): {
  provider: string;
  model: string;
} {
  const fact = decodeSessionFact(bytes);
  if (
    !isRecord(fact) ||
    typeof fact['provider'] !== 'string' ||
    typeof fact['model'] !== 'string'
  ) {
    throw malformed(SESSION_KEYS.provider);
  }
  return { provider: fact['provider'], model: fact['model'] };
}

/** The directories a `session:directories` entry holds. */
export function decodeDirectoriesFact(bytes: Uint8Array): string[] {
  const fact = decodeSessionFact(bytes);
  if (!Array.isArray(fact)) throw malformed(SESSION_KEYS.directories);
  const directories: string[] = [];
  for (const item of fact as unknown[]) {
    if (typeof item !== 'string') throw malformed(SESSION_KEYS.directories);
    directories.push(item);
  }
  return directories;
}

/** The title of a `session:title` entry: a string, or null for explicitly untitled. */
export function decodeTitleFact(bytes: Uint8Array): string | null {
  const fact = decodeSessionFact(bytes);
  if (fact !== null && typeof fact !== 'string') {
    throw malformed(SESSION_KEYS.title);
  }
  return fact;
}

/** What `session:start` holds: the facts fixed when the file was created. */
export interface SessionStartFact {
  readonly startTime: string;
  readonly projectHash: string;
  readonly workspaceDirs: string[];
  readonly cwd?: string;
  readonly kind: SessionStartKind;
  readonly parentSessionId?: string;
}

type StartFields = Record<string, unknown> & {
  startTime: string;
  projectHash: string;
  kind: SessionStartKind;
  workspaceDirs: unknown[];
};

function hasStartFields(fact: Record<string, unknown>): fact is StartFields {
  const strings = ['startTime', 'projectHash'].every(
    (key) => typeof fact[key] === 'string',
  );
  const kind = fact['kind'] === 'main' || fact['kind'] === 'subagent';
  return strings && kind && Array.isArray(fact['workspaceDirs']);
}

export function decodeStartFact(bytes: Uint8Array): SessionStartFact {
  const fact = decodeSessionFact(bytes);
  if (!isRecord(fact) || !hasStartFields(fact)) {
    throw malformed(SESSION_KEYS.start);
  }
  const { cwd, parentSessionId } = fact;
  return {
    startTime: fact['startTime'],
    projectHash: fact['projectHash'],
    workspaceDirs: fact['workspaceDirs'].map(String),
    kind: fact['kind'],
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof parentSessionId === 'string' ? { parentSessionId } : {}),
  };
}

/** The session facts of one journal, as discovery and resume need them. */
export interface SessionFacts {
  readonly sessionId: string;
  readonly start: SessionStartFact;
  readonly provider: string;
  readonly model: string;
  readonly directories: string[];
  /** Undefined when never set; null for explicitly untitled. */
  readonly title?: string | null;
  /** Undefined when never set; null once cleared. */
  readonly name?: string | null;
}

/**
 * Reads the facts from a state map. Undefined when the journal holds no
 * `session:id` entry (no session group was ever committed). A missing
 * `session:start` or `session:provider` entry is a damaged file, because the
 * recorder writes them in the same group as the id.
 */
export async function readSessionFacts(
  read: StateReader,
): Promise<SessionFacts | undefined> {
  const id = await read(SESSION_KEYS.id);
  if (id === undefined) return undefined;
  const sessionId = decodeSessionFact(id);
  const start = await read(SESSION_KEYS.start);
  const provider = await read(SESSION_KEYS.provider);
  if (typeof sessionId !== 'string' || !start || !provider) {
    throw malformed(SESSION_KEYS.id);
  }
  const directories = await read(SESSION_KEYS.directories);
  const title = await read(SESSION_KEYS.title);
  const name = await read(SESSION_KEYS.name);
  const startFact = decodeStartFact(start);
  return {
    sessionId,
    start: startFact,
    ...decodeProviderFact(provider),
    directories:
      directories === undefined
        ? startFact.workspaceDirs
        : decodeDirectoriesFact(directories),
    ...(title === undefined ? {} : { title: decodeTitleFact(title) }),
    ...(name === undefined ? {} : { name: decodeTitleFact(name) }),
  };
}
