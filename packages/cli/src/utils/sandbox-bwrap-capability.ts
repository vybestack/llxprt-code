/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { resolveBwrapExecutable } from './sandbox-bwrap-executable.js';

const BWRAP_PROBE_TIMEOUT_MS = 1500;

export function probeBwrapCapability(): void {
  if (process.platform !== 'linux') {
    throw new FatalSandboxError(
      'The bwrap sandbox engine is supported only on Linux.',
    );
  }

  const executable = resolveBwrapExecutable();
  if (executable === undefined) {
    throw new FatalSandboxError(
      'The bwrap executable was not found on PATH. Install bubblewrap or choose an available container engine.',
    );
  }

  const result = spawnSync(
    executable,
    [
      '--unshare-user',
      '--unshare-pid',
      '--disable-userns',
      '--die-with-parent',
      '--ro-bind',
      '/',
      '/',
      '--',
      '/bin/true',
    ],
    {
      encoding: 'utf8',
      timeout: BWRAP_PROBE_TIMEOUT_MS,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      stdio: 'ignore',
    },
  );

  if (result.error !== undefined || result.status !== 0) {
    const cause = result.error?.message;
    throw new FatalSandboxError(
      `bwrap is installed, but its required Linux user and PID namespaces are unavailable${cause ? ` (${cause})` : ''}. Enable unprivileged user namespaces or choose an available container engine.`,
    );
  }
}
