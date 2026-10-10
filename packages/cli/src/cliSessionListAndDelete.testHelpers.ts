/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared helpers for the --list-sessions / --delete-session subprocess tests:
 * running the real CLI entry point and writing real session recordings.
 */

import { spawn } from 'node:child_process';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core';

const CLI_ENTRY = resolve(import.meta.dir, '..', 'index.ts');

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
): Promise<string> {
  const recording = new SessionRecordingService({
    chatsDir: target.chatsDir,
    sessionId,
    projectHash: target.projectHash,
    workspaceDirs: [target.projectDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  try {
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
    });
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
  await mkdir(target.chatsDir, { recursive: true });
  const filePath = join(
    target.chatsDir,
    `session-2026-10-08T21-18-08-${sessionId.slice(0, 12)}.jsonl`,
  );
  const header = {
    v: 1,
    seq: 1,
    ts: '2026-10-08T21:18:08.000Z',
    type: 'session_start',
    payload: {
      sessionId,
      projectHash: target.projectHash,
      workspaceDirs: ['/x'],
      provider: 'anthropic',
      model: 42,
      startTime: '2026-10-08T21:18:08.000Z',
    },
  };
  await writeFile(filePath, `${JSON.stringify(header)}\n`, 'utf-8');
  return filePath;
}
