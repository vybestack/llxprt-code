/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

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
} as const;

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
