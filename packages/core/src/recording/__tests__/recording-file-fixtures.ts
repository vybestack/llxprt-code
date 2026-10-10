/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * On-disk session file fixtures written byte-for-byte like recordings that
 * real (older or crashed) clients left behind, for discovery/resume tests.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface FixtureFile {
  readonly filePath: string;
  readonly sessionId: string;
}

interface FixtureLine {
  /** Recording version stamped on the line; defaults to 1. */
  readonly v?: number;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
}

async function writeFixtureFile(
  chatsDir: string,
  sessionId: string,
  timestamp: string,
  lines: readonly FixtureLine[],
): Promise<FixtureFile> {
  await fs.mkdir(chatsDir, { recursive: true });
  const fileName = `session-${timestamp.slice(0, 19).replace(/:/g, '-')}-${sessionId.slice(0, 12)}.jsonl`;
  const filePath = path.join(chatsDir, fileName);
  const body = lines
    .map((line) =>
      JSON.stringify({
        v: line.v ?? 1,
        seq: line.seq,
        ts: timestamp,
        type: line.type,
        payload: line.payload,
      }),
    )
    .join('\n');
  await fs.writeFile(filePath, `${body}\n`, 'utf-8');
  return { filePath, sessionId };
}

function humanContent(text: string): unknown {
  return { content: { speaker: 'human', blocks: [{ type: 'text', text }] } };
}

function aiContent(text: string): unknown {
  return { content: { speaker: 'ai', blocks: [{ type: 'text', text }] } };
}

/**
 * A recording shaped exactly like the files written when llxprt started with
 * no provider configured and a profile was loaded before the first message:
 * header says provider "unknown" / model "", followed by the real
 * provider_switch and the conversation.
 */
export function writeLegacyUnknownProviderSession(
  chatsDir: string,
  options: {
    readonly sessionId: string;
    readonly projectHash: string;
    readonly timestamp: string;
  },
): Promise<FixtureFile> {
  const { sessionId, projectHash, timestamp } = options;
  return writeFixtureFile(chatsDir, sessionId, timestamp, [
    {
      seq: 1,
      type: 'session_start',
      payload: {
        sessionId,
        projectHash,
        workspaceDirs: ['/x'],
        provider: 'unknown',
        model: '',
        startTime: timestamp,
      },
    },
    {
      seq: 2,
      type: 'session_event',
      payload: { severity: 'info', message: 'Profile loaded' },
    },
    {
      seq: 3,
      type: 'session_event',
      payload: { severity: 'info', message: 'Ready' },
    },
    {
      seq: 4,
      type: 'provider_switch',
      payload: { provider: 'claudecode', model: 'claude-opus-5-5' },
    },
    { seq: 5, type: 'content', payload: humanContent('legacy question') },
    { seq: 6, type: 'content', payload: aiContent('legacy answer') },
  ]);
}

/**
 * A recording whose header is genuinely corrupt (model is not a string), so
 * replay rejects it no matter what the legacy-header contract allows.
 */
export function writeCorruptHeaderSession(
  chatsDir: string,
  options: {
    readonly sessionId: string;
    readonly projectHash: string;
    readonly timestamp: string;
  },
): Promise<FixtureFile> {
  const { sessionId, projectHash, timestamp } = options;
  return writeFixtureFile(chatsDir, sessionId, timestamp, [
    {
      seq: 1,
      type: 'session_start',
      payload: {
        sessionId,
        projectHash,
        workspaceDirs: ['/x'],
        provider: 'anthropic',
        model: 42,
        startTime: timestamp,
      },
    },
    { seq: 2, type: 'content', payload: humanContent('corrupt question') },
  ]);
}

/** A recording file with exactly the given text, for malformed-header cases. */
export async function writeRawRecordingFile(
  chatsDir: string,
  fileName: string,
  text: string,
): Promise<string> {
  await fs.mkdir(chatsDir, { recursive: true });
  const filePath = path.join(chatsDir, fileName);
  await fs.writeFile(filePath, text, 'utf-8');
  return filePath;
}

/**
 * A recording whose session_start payload is exactly `payload`, so tests can
 * corrupt individual header fields (for example a numeric sessionId).
 */
export function writeSessionWithHeaderPayload(
  chatsDir: string,
  fileName: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  const header = {
    v: 1,
    seq: 1,
    ts: '2026-10-08T21:18:08.000Z',
    type: 'session_start',
    payload,
  };
  return writeRawRecordingFile(
    chatsDir,
    fileName,
    `${JSON.stringify(header)}\n`,
  );
}

/**
 * A recording with a valid header whose content line carries a recording
 * version this client does not support, so the header lists fine but replay
 * rejects the file.
 */
export function writeUnsupportedVersionSession(
  chatsDir: string,
  options: {
    readonly sessionId: string;
    readonly projectHash: string;
    readonly timestamp: string;
  },
): Promise<FixtureFile> {
  const { sessionId, projectHash, timestamp } = options;
  return writeFixtureFile(chatsDir, sessionId, timestamp, [
    {
      seq: 1,
      type: 'session_start',
      payload: {
        sessionId,
        projectHash,
        workspaceDirs: ['/x'],
        provider: 'anthropic',
        model: 'claude-4',
        startTime: timestamp,
      },
    },
    {
      v: 99,
      seq: 2,
      type: 'content',
      payload: humanContent('from the future'),
    },
  ]);
}
