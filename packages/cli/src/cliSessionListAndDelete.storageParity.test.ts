/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3839: --list-sessions / --delete-session must look in exactly the
 * chats directory session recording uses.
 *
 * The scenario: folder trust is enabled, the workspace is untrusted, and the
 * user-global .env sets LLXPRT_LOG_HOME. The settings-stage env loader skips
 * loading for an untrusted folder, but the Config-stage loader applies the
 * user-global file, so Config (and therefore recording) resolves its chats
 * directory under the overridden log home. A Storage built straight from the
 * workspace root would look somewhere else.
 *
 * Each case runs the real CLI as a subprocess against real temp directories.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  runCliProcess,
  writeHealthySession,
  type CliRun,
  type RecordingTarget,
} from './cliSessionListAndDelete.testHelpers.js';

const SUBPROCESS_TIMEOUT_MS = 90_000;
const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('--list-sessions / --delete-session storage parity with recording (issue #3839)', () => {
  let root: string;
  let projectDir: string;
  let configHome: string;
  let logHome: string;
  let recordingTarget: RecordingTarget;
  let plainStorageChatsDir: string;

  beforeEach(async () => {
    root = await realpath(
      await mkdtemp(join(tmpdir(), 'cli-storage-parity-3839-')),
    );
    projectDir = join(root, 'workspace');
    configHome = join(root, 'config-home');
    logHome = join(root, 'overridden-log-home');
    await mkdir(projectDir, { recursive: true });
    await mkdir(configHome, { recursive: true });

    // Folder trust on; nothing marks the workspace trusted.
    await writeFile(
      join(configHome, 'settings.json'),
      JSON.stringify({ folderTrust: true }),
      'utf-8',
    );
    // A permitted (user-global) .env that redirects the log/state root.
    await writeFile(
      join(configHome, '.env'),
      `LLXPRT_LOG_HOME=${logHome}\n`,
      'utf-8',
    );

    // Where recording writes once Config has applied the user-global .env.
    const chatsDir = join(
      logHome,
      'tmp',
      Storage.getProjectHistoryKey(projectDir),
      'chats',
    );
    recordingTarget = {
      projectDir,
      chatsDir,
      projectHash: getProjectHash(projectDir),
    };
    // Where a plain Storage(cwd) looks when the log home is not overridden:
    // the log root falls back to the config home.
    plainStorageChatsDir = join(
      configHome,
      'tmp',
      Storage.getProjectHistoryKey(projectDir),
      'chats',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function runCli(args: string[]): Promise<CliRun> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEV: 'true',
      LLXPRT_CONFIG_HOME: configHome,
    };
    // The override must come from the .env file, not the shell.
    delete env['LLXPRT_LOG_HOME'];
    return runCliProcess(args, projectDir, env);
  }

  async function exists(filePath: string): Promise<boolean> {
    return stat(filePath).then(
      () => true,
      () => false,
    );
  }

  it('the plain-Storage location differs from the recording location in this setup', () => {
    expect(plainStorageChatsDir).not.toBe(recordingTarget.chatsDir);
  });

  it(
    '--list-sessions lists the sessions in the directory recording uses',
    async () => {
      await writeHealthySession(
        recordingTarget,
        SESSION_ID,
        '2026-10-01T00:00:00Z',
      );

      const run = await runCli(['--list-sessions']);

      expect({
        exitCode: run.exitCode,
        header: run.stdout.includes('Sessions for this project (1):'),
        listed: run.stdout.includes('a1b2c3d4'),
      }).toStrictEqual({ exitCode: 0, header: true, listed: true });
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    '--delete-session deletes from the directory recording uses',
    async () => {
      const filePath = await writeHealthySession(
        recordingTarget,
        SESSION_ID,
        '2026-10-01T00:00:00Z',
      );

      const run = await runCli(['--delete-session', 'a1b2c3d4']);

      expect({
        exitCode: run.exitCode,
        confirmed: run.stdout.includes('Deleted session a1b2c3d4'),
        stillThere: await exists(filePath),
      }).toStrictEqual({ exitCode: 0, confirmed: true, stillThere: false });
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});
