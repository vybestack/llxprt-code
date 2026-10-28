/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, vi } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { AggregateDisposeError } from '../../disposeErrors.js';
import { openClientOwner } from './client-owner-session.js';

/** The owner reports its client's failure inside nested aggregates. */
function failureLeaves(failure: unknown): readonly unknown[] {
  return failure instanceof AggregateError ||
    failure instanceof AggregateDisposeError
    ? failure.errors.flatMap(failureLeaves)
    : [failure];
}

/**
 * Builds domain-level `SessionClientOwner`s (through `openClientOwner`, whose
 * client factory is the parameter production fills) whose session client
 * fails its disposal. The failure is injected on the real client the owner
 * retains, the last one its client factory returned (an instance spy). The
 * returned function closes the owner stack and yields the failures its
 * disposal reports.
 */
export function installFailingSessionFixture(): (
  failure: Error,
) => Promise<() => Promise<readonly unknown[]>> {
  const directories: string[] = [];
  afterEach(async () => {
    const removals = await Promise.allSettled(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
    const failures = removals.flatMap((removal) =>
      removal.status === 'rejected' ? [removal.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Failing session cleanup failed');
  });
  return async (failure) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'failing-session-')),
    );
    directories.push(directory);
    const opened = await openClientOwner(
      new CredentialAuthority(),
      {
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        harness: { includeProcessCwd: false },
      },
      { provider: 'fake', model: 'fake-model' },
    );
    vi.spyOn(opened.client, 'dispose').mockImplementation(async () => {
      throw failure;
    });
    return async (): Promise<readonly unknown[]> =>
      opened.close().then(
        () => {
          throw new Error('Expected session cleanup failure');
        },
        (error: unknown) => {
          if (!(error instanceof AggregateDisposeError)) throw error;
          return failureLeaves(error);
        },
      );
  };
}
