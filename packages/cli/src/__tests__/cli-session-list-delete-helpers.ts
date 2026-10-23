/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared helpers for the --list-sessions / --delete-session subprocess tests:
 * running the real CLI entry point and writing real session recordings.
 */

import {
  createRecorderForTest,
  recordRowsForTest,
} from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { spawn } from 'node:child_process';
import { utimes } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import {
  encodeSessionFact,
  SESSION_KEYS,
} from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';

export function corruptSessionReason(): string {
  return 'Session fact session:provider is not in the expected form';
}

const CLI_ENTRY = resolve(import.meta.dir, '..', '..', 'index.ts');

export interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Where a project's recordings live and how they are tagged. */
export interface RecordingTarget {
  projectDir: string;
  chatsDir: string;
  projectHash: string;
}

/** Run the real CLI as a subprocess with no stdin, in `cwd` with `env`. */
export function runCliProcess(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CliRun> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf-8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', rejectRun);
    child.on('close', (exitCode) => {
      resolveRun({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

export async function writeHealthySession(
  target: RecordingTarget,
  sessionId: string,
  modified: string,
  model = 'test-model',
): Promise<string> {
  const recording = createRecorderForTest({
    chatsDir: target.chatsDir,
    sessionId,
    projectHash: target.projectHash,
    workspaceDirs: [target.projectDir],
    provider: 'test-provider',
    model,
  });
  try {
    await recordRowsForTest(recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
      },
    ]);
    if (recording instanceof JournalRecordingService)
      recording.recordFirstUserPreview(`hello from ${sessionId}`);
    await recording.flush();
    const filePath = recording.getFilePath();
    if (filePath === null) {
      throw new Error(`Recording for session ${sessionId} has no file path`);
    }
    const when = new Date(modified);
    await utimes(filePath, when, when);
    return filePath;
  } finally {
    await recording.dispose();
  }
}

/** A recording whose session_start header discovery cannot parse. */
export async function writeCorruptSession(
  target: RecordingTarget,
  sessionId: string,
): Promise<string> {
  const path = await writeHealthySession(
    target,
    sessionId,
    '2026-10-08T21:18:08.000Z',
  );
  const session = await JournalSession.open(path);
  try {
    await session.store.commit([
      {
        kind: 'setState',
        key: SESSION_KEYS.provider,
        value: encodeSessionFact({ provider: 'anthropic', model: 42 }),
      },
    ]);
  } finally {
    await session.close();
  }
  return path;
}
