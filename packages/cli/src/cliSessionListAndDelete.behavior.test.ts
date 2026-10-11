/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3839: --list-sessions / --delete-session must work with no prompt, no
 * stdin data, no TTY and no configured provider, and print to stdout/stderr.
 *
 * Each case runs the real CLI entry point as a subprocess against a real temp
 * project directory holding real session recordings. The storage roots the
 * test preload isolates are inherited by the child, so nothing touches the
 * developer's real llxprt directories.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  runCliProcess,
  writeCorruptSession as writeCorrupt,
  writeHealthySession as writeHealthy,
  type CliRun,
  type RecordingTarget,
} from './cliSessionListAndDelete.testHelpers.js';

const STDIN_ERROR = 'No input provided via stdin';
const NO_SESSIONS = 'No recorded sessions for this project.';
const UNCONFIGURED_PROVIDER_FRAGMENT = 'No provider is configured';
const SUBPROCESS_TIMEOUT_MS = 90_000;

describe('--list-sessions / --delete-session outside a TTY (issue #3839)', () => {
  let projectDir: string;
  let chatsDir: string;
  let projectHash: string;

  beforeEach(async () => {
    // The CLI resolves its project root from process.cwd(), which is the
    // realpath of the directory (macOS temp dirs are symlinked).
    projectDir = await realpath(
      await mkdtemp(join(tmpdir(), 'cli-list-sessions-3839-')),
    );
    chatsDir = join(new Storage(projectDir).getProjectTempDir(), 'chats');
    projectHash = getProjectHash(projectDir);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    await rm(join(chatsDir, '..'), { recursive: true, force: true });
  });

  const target = (): RecordingTarget => ({ projectDir, chatsDir, projectHash });

  function runCli(args: string[]): Promise<CliRun> {
    return runCliProcess(args, projectDir, { ...process.env, DEV: 'true' });
  }

  const writeHealthySession = (
    sessionId: string,
    modified: string,
    model?: string,
  ): Promise<string> => writeHealthy(target(), sessionId, modified, model);

  const writeCorruptSession = (sessionId: string): Promise<string> =>
    writeCorrupt(target(), sessionId);

  async function chatFiles(): Promise<string[]> {
    return (await readdir(chatsDir)).sort();
  }

  async function exists(filePath: string): Promise<boolean> {
    return stat(filePath).then(
      () => true,
      () => false,
    );
  }

  it(
    'lists every recorded session on stdout, exits 0, and never reports the missing stdin (plan test 1)',
    async () => {
      await writeHealthySession(
        'aaaaaaaa-1111-4111-8111-111111111111',
        '2026-10-01T00:00:00Z',
      );
      await writeHealthySession(
        'bbbbbbbb-2222-4222-8222-222222222222',
        '2026-10-02T00:00:00Z',
      );

      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        stdoutHasHeader: run.stdout.includes('Sessions for this project (2):'),
        stdoutHasFirst: run.stdout.includes('aaaaaaaa'),
        stdoutHasSecond: run.stdout.includes('bbbbbbbb'),
        stdinErrorOnStdout: run.stdout.includes(STDIN_ERROR),
        stdinErrorOnStderr: run.stderr.includes(STDIN_ERROR),
      }).toStrictEqual({
        exitCode: 0,
        stdoutHasHeader: true,
        stdoutHasFirst: true,
        stdoutHasSecond: true,
        stdinErrorOnStdout: false,
        stdinErrorOnStderr: false,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'says there are no recorded sessions on stdout and exits 0 for a project without sessions (plan test 2)',
    async () => {
      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        stdout: run.stdout.trim(),
        stderr: run.stderr.trim(),
      }).toStrictEqual({ exitCode: 0, stdout: NO_SESSIONS, stderr: '' });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    '--delete-session removes the session file and confirms on stdout with exit 0 (plan test 3)',
    async () => {
      const doomed = await writeHealthySession(
        'cccccccc-3333-4333-8333-333333333333',
        '2026-10-01T00:00:00Z',
      );
      const kept = await writeHealthySession(
        'dddddddd-4444-4444-8444-444444444444',
        '2026-10-02T00:00:00Z',
      );

      const run = await runCli(['--delete-session', 'cccccccc']);

      expect({
        exitCode: run.exitCode,
        confirmedOnStdout: run.stdout.includes('Deleted session cccccccc'),
        stderr: run.stderr.trim(),
        doomedExists: await exists(doomed),
        keptExists: await exists(kept),
      }).toStrictEqual({
        exitCode: 0,
        confirmedOnStdout: true,
        stderr: '',
        doomedExists: false,
        keptExists: true,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    '--delete-session with an unknown reference reports the error on stderr, exits 1, and deletes nothing (plan test 3)',
    async () => {
      await writeHealthySession(
        'eeeeeeee-5555-4555-8555-555555555555',
        '2026-10-01T00:00:00Z',
      );
      const filesBefore = await chatFiles();

      const run = await runCli(['--delete-session', 'no-such-session']);

      expect({
        exitCode: run.exitCode,
        stdout: run.stdout.trim(),
        errorOnStderr: run.stderr.includes('no-such-session'),
        filesUnchanged: (await chatFiles()).join('|') === filesBefore.join('|'),
      }).toStrictEqual({
        exitCode: 1,
        stdout: '',
        errorOnStderr: true,
        filesUnchanged: true,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'lists the healthy session on stdout and reports one skipped-recordings block with path and reason on stderr, still exiting 0 (plan test 4)',
    async () => {
      await writeHealthySession(
        'ffffffff-6666-4666-8666-666666666666',
        '2026-10-01T00:00:00Z',
      );
      const corruptPath = await writeCorruptSession('corrupt-0004');

      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        healthyOnStdout: run.stdout.includes('ffffffff'),
        corruptOnStdout: run.stdout.includes(corruptPath),
        skippedBlockOnStderr: run.stderr.includes(
          `Skipped 1 unreadable session recording(s):\n  ${corruptPath}: Invalid session_start: missing or malformed required fields`,
        ),
        skippedBlocks: run.stderr.split('Skipped ').length - 1,
      }).toStrictEqual({
        exitCode: 0,
        healthyOnStdout: true,
        corruptOnStdout: false,
        skippedBlockOnStderr: true,
        skippedBlocks: 1,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    '--delete-session deletes the matching session beside a corrupt recording, exits 0, and reports the skipped recording on stderr',
    async () => {
      const doomed = await writeHealthySession(
        'abababab-1212-4212-8212-121212121212',
        '2026-10-01T00:00:00Z',
      );
      const corruptPath = await writeCorruptSession('corrupt-0005');

      const run = await runCli(['--delete-session', 'abababab']);

      expect({
        exitCode: run.exitCode,
        confirmedOnStdout: run.stdout.includes('Deleted session abababab'),
        skippedBlockOnStderr: run.stderr.includes(
          `Skipped 1 unreadable session recording(s):\n  ${corruptPath}: Invalid session_start: missing or malformed required fields`,
        ),
        skippedBlocks: run.stderr.split('Skipped ').length - 1,
        doomedExists: await exists(doomed),
        corruptExists: await exists(corruptPath),
      }).toStrictEqual({
        exitCode: 0,
        confirmedOnStdout: true,
        skippedBlockOnStderr: true,
        skippedBlocks: 1,
        doomedExists: false,
        corruptExists: true,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    '--delete-session with a reference that matches nothing still reports the corrupt recording on stderr, exits 1, and deletes nothing',
    async () => {
      await writeHealthySession(
        'cdcdcdcd-3434-4434-8434-343434343434',
        '2026-10-01T00:00:00Z',
      );
      const corruptPath = await writeCorruptSession('corrupt-0006');
      const filesBefore = await chatFiles();

      const run = await runCli(['--delete-session', 'no-such-session']);

      expect({
        exitCode: run.exitCode,
        stdout: run.stdout.trim(),
        errorOnStderr: run.stderr.includes('no-such-session'),
        skippedBlockOnStderr: run.stderr.includes(
          `Skipped 1 unreadable session recording(s):\n  ${corruptPath}: Invalid session_start: missing or malformed required fields`,
        ),
        filesUnchanged: (await chatFiles()).join('|') === filesBefore.join('|'),
      }).toStrictEqual({
        exitCode: 1,
        stdout: '',
        errorOnStderr: true,
        skippedBlockOnStderr: true,
        filesUnchanged: true,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'lists sessions with no provider configured, without the unconfigured-provider exit (plan test 5)',
    async () => {
      await writeHealthySession(
        '99999999-7777-4777-8777-777777777777',
        '2026-10-01T00:00:00Z',
      );

      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        listed: run.stdout.includes('99999999'),
        unconfiguredProviderReported:
          run.stdout.includes(UNCONFIGURED_PROVIDER_FRAGMENT) ||
          run.stderr.includes(UNCONFIGURED_PROVIDER_FRAGMENT),
      }).toStrictEqual({
        exitCode: 0,
        listed: true,
        unconfiguredProviderReported: false,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'still lists and exits when a prompt is supplied together with --list-sessions',
    async () => {
      await writeHealthySession(
        '12121212-8888-4888-8888-888888888888',
        '2026-10-01T00:00:00Z',
      );

      const run = await runCli(['--list-sessions', '--prompt', 'ignored']);

      expect({
        exitCode: run.exitCode,
        listed: run.stdout.includes('12121212'),
      }).toStrictEqual({ exitCode: 0, listed: true });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'listing does not start a recording: the chats directory is exactly what the test wrote (plan test 6)',
    async () => {
      await writeHealthySession(
        '34343434-9999-4999-8999-999999999999',
        '2026-10-01T00:00:00Z',
      );
      const filesBefore = await chatFiles();

      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        files: (await chatFiles()).join('|'),
      }).toStrictEqual({ exitCode: 0, files: filesBefore.join('|') });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'delivers a listing larger than a pipe buffer in full before exiting 0',
    async () => {
      // Each line carries a ~4 KB model name, so 40 sessions (~160 KB) exceed
      // the 64 KB pipe buffer. Truncation at process.exit would drop lines.
      const sessionCount = 40;
      const prefixes: string[] = [];
      for (let i = 0; i < sessionCount; i++) {
        const prefix = i.toString(16).padStart(8, '0');
        prefixes.push(prefix);
        await writeHealthySession(
          `${prefix}-0000-4000-8000-000000000000`,
          '2026-10-01T00:00:00Z',
          `model-${prefix}-${'x'.repeat(4000)}`,
        );
      }

      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        header: run.stdout.includes(
          `Sessions for this project (${sessionCount}):`,
        ),
        missingSessions: prefixes.filter(
          (prefix) =>
            !run.stdout.includes(`model-${prefix}-${'x'.repeat(4000)}`),
        ),
        endsWithNewline: run.stdout.endsWith('\n'),
      }).toStrictEqual({
        exitCode: 0,
        header: true,
        missingSessions: [],
        endsWithNewline: true,
      });
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});
