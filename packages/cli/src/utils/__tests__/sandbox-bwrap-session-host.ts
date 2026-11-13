/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host process for sandbox-bwrap-session-dirs.behavior.test.ts. It runs the
 * production bwrap launch function and exits with the launch result, the way
 * maybeHopIntoSandbox does. The sandbox runs the script named by
 * SANDBOX_PAYLOAD in place of the CLI entry point.
 */

import fs from 'node:fs';
import { runBwrapSandbox } from '../sandbox-bwrap.js';

process.argv[1] = process.env['SANDBOX_PAYLOAD'] ?? '';
const exitCode = await runBwrapSandbox(
  { command: 'bwrap' as const },
  [],
  undefined,
  ['llxprt', '--experimental-acp'],
);
fs.writeFileSync('exit-code', String(exitCode));
process.exit(exitCode);
