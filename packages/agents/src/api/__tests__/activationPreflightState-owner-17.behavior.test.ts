/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'bun:test';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const run = promisify(execFile);

describe('preflight adoption boundaries', () => {
  const credentials = useOwnedCredentials();

  it('invalidates an old receipt while a retry waits at an external credential boundary', async () => {
    const initial = createRecordingProvider({ alias: 'initial-local' });
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      contributions: initial.contributions,
      config: {
        provider: initial.alias,
        model: 'recording-default',
      },
    });
    const directory = await mkdtemp(join(tmpdir(), 'preflight-owner-fifo-'));
    // A named pipe is an external credential source that blocks its reader
    // until the test opens the other end.
    const keyfile = join(directory, 'credential.pipe');
    await run('mkfifo', [keyfile]);
    try {
      await route.prepare();
      const previous = await route.preflight.preflight({
        provider: initial.alias,
        authMode: 'auto',
      });
      if (!previous.token) throw new Error('Missing receipt');
      const retry = route.preflight.preflight({
        provider: initial.alias,
        authMode: 'auto',
        cliOverrides: { keyfile },
      });
      // Opening the write end completes only once the preflight reads the pipe.
      const pipe = await open(keyfile, 'w');
      const rejection = AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        previous.token,
        { provider: initial.alias, authMode: 'auto' },
        {},
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      await pipe.writeFile('pipe-credential');
      await pipe.close();
      expect(String(await rejection)).toContain('Activation preflight token');
      await retry;
    } finally {
      await route.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
