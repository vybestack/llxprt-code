/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Payload for sandbox-bwrap-signals.behavior.test.ts. The production launcher
 * runs it inside a real bwrap sandbox in place of the CLI entry point. Its
 * working directory is the sandbox workspace, the only place it can write
 * where the test can read.
 *
 * It records the PID namespace it lives in, then reports `ready`. A forwarded
 * SIGINT, SIGTERM or SIGHUP is recorded in `received` and ends the payload
 * with HANDLED_EXIT_STATUS, as a CLI that shuts down gracefully would.
 *
 * When the workspace holds a `stubborn` file, the payload models an agent
 * whose shutdown waits for an unfinished model turn: it keeps a tool
 * subprocess (`sleep`) running, writes protocol output to its stdout, records
 * the signal in `received` and then keeps running.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const HANDLED_EXIT_STATUS = 7;
const STUBBORN = fs.existsSync('stubborn');

function writeAtomically(name: string, contents: string): void {
  fs.writeFileSync(`${name}.tmp`, contents);
  fs.renameSync(`${name}.tmp`, name);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    writeAtomically('received', signal);
    if (!STUBBORN) process.exit(HANDLED_EXIT_STATUS);
  });
}

if (STUBBORN) {
  const tool = spawn('sleep', ['600'], { stdio: 'ignore' });
  writeAtomically('tool', String(tool.pid));
  // Protocol traffic to a client that may be gone; a write error is not fatal.
  process.stdout.on('error', () => {});
  setInterval(() => process.stdout.write('{"jsonrpc":"2.0"}\n'), 100);
}

writeAtomically('pidns', fs.readlinkSync('/proc/self/ns/pid'));
writeAtomically('ready', String(process.pid));
setInterval(() => {}, 1000);
