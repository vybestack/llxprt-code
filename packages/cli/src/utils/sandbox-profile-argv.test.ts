/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import os from 'node:os';
import { entrypoint } from './sandbox-entrypoint.js';
import { buildSeatbeltArgs } from './sandbox-seatbelt.js';

/**
 * A profile (and so its shell-inactivity-timeout-seconds) reaches the sandboxed
 * CLI because the hop relaunches it with the original argv and the inner CLI
 * loads the profile from the mounted config directory (issue #4094). These
 * tests pin the argv half of that: the profile selection must survive into the
 * command each sandbox kind finally runs.
 */
describe('sandbox relaunch keeps the profile selection (issue #4094)', () => {
  const argv = ['node', 'llxprt', '--profile-load', 'long running', 'go'];

  it('passes --profile-load to the in-container CLI command', () => {
    const script = entrypoint(os.tmpdir(), argv)[7];

    expect(script).toContain("--profile-load 'long running' go");
  });

  it('passes --profile-load to the seatbelt CLI command', () => {
    const args = buildSeatbeltArgs(
      '/tmp/profile.sb',
      'node-opts',
      undefined,
      argv.slice(1),
    );

    expect(args.at(-1)).toContain("--profile-load 'long running' go");
  });
});
