/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host process for sandbox-signal-forwarding.test.ts. It runs the real
 * selected sandbox launch path against a stand-in launcher, then exits with
 * the launch result exactly as maybeHopIntoSandbox does after the hop. The
 * test signals this process the way an ACP client signals the agent it
 * started.
 *
 * Stand-in executables named `sandbox-exec` and `bwrap` let the tests drive
 * either launch path without requiring that host engine. STUB_DIR names the
 * directory the test and stand-in share. HOST_SANDBOX_COMMAND replaces the
 * Seatbelt launcher name, so a test can point the launch at an executable
 * that does not exist.
 *
 * The host writes `ready` into STUB_DIR once the launch path has registered
 * its signal handlers. A signal that arrives earlier meets Node's default
 * disposition and kills this process, so the test must not signal until it
 * sees that file; the stand-in having started says nothing about the host.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeatbeltSandbox } from '../sandbox-seatbelt.js';
import { runBwrapSandbox } from '../sandbox-bwrap.js';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

function listenerCounts(): Record<string, number> {
  return Object.fromEntries(
    SIGNALS.map((signal) => [signal, process.listenerCount(signal)]),
  );
}

const before = listenerCounts();
const stubDir = process.env['STUB_DIR'] ?? '.';
// The launch awaits the stand-in's exit, so a timer is the only way to observe
// the moment its handlers appear. Listener counts are public process state.
const readiness = setInterval(() => {
  const now = listenerCounts();
  if (SIGNALS.every((signal) => now[signal] > before[signal])) {
    clearInterval(readiness);
    fs.writeFileSync(path.join(stubDir, 'ready'), '');
  }
}, 5);
if (process.env['SANDBOX_SIGNAL_TEST_ENGINE'] === 'bwrap') {
  process.argv[1] = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../cli.tsx',
  );
}
const exitCode =
  process.env['SANDBOX_SIGNAL_TEST_ENGINE'] === 'bwrap'
    ? await runBwrapSandbox({ command: 'bwrap' as const }, [], undefined, [
        'llxprt',
        '--experimental-acp',
      ])
    : await runSeatbeltSandbox(
        {
          command: (process.env['HOST_SANDBOX_COMMAND'] ??
            'sandbox-exec') as 'sandbox-exec',
          image: 'unused',
        },
        [],
        undefined,
        ['llxprt', '--experimental-acp'],
      );
clearInterval(readiness);
// The report goes to a file: the stand-in inherits this process's stdio, so a
// pipe-based report would stay open for as long as an orphaned child lives.
fs.writeFileSync(
  path.join(stubDir, 'report.json'),
  JSON.stringify({ exitCode, before, after: listenerCounts() }),
);
process.exit(exitCode);
