/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host process for sandbox-bwrap-signals.behavior.test.ts. It calls the
 * production bwrap launch function, with the same argv builder and options-FD
 * transport the CLI uses, and exits with the launch result exactly as
 * maybeHopIntoSandbox does after the hop. The sandbox runs the script named
 * by SANDBOX_PAYLOAD (sandbox-bwrap-signal-payload.ts) in place of the CLI
 * entry point, the way the launcher runs argv[1]. The test
 * signals this process the way a supervisor signals the agent it started.
 * SANDBOX_STOP_GRACE_MS shortens the grace period the launcher allows a
 * payload to shut down after SIGTERM or SIGHUP.
 */

import fs from 'node:fs';
import { runBwrapSandbox } from '../sandbox-bwrap.js';

process.argv[1] = process.env['SANDBOX_PAYLOAD'] ?? '';
fs.writeFileSync('host.pid', String(process.pid));
const stopGraceMs = process.env['SANDBOX_STOP_GRACE_MS'];
const exitCode = await runBwrapSandbox(
  { command: 'bwrap' as const },
  [],
  undefined,
  ['llxprt', '--experimental-acp'],
  undefined,
  stopGraceMs === undefined ? undefined : { stopGraceMs: Number(stopGraceMs) },
);
fs.writeFileSync('exit-code', String(exitCode));
process.exit(exitCode);
