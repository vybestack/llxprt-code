/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host process for sandbox-bwrap-launch.behavior.test.ts. It runs the
 * production bwrap launch function with the profile named by
 * SANDBOX_CONFIG_JSON and records the outcome in the working directory:
 * `exit-code` after a launch, `launch-error` when the launch is refused. The
 * sandbox runs the script named by SANDBOX_PAYLOAD in place of the CLI entry
 * point.
 */

import fs from 'node:fs';
import { runBwrapSandbox } from '../sandbox-bwrap.js';

process.argv[1] = process.env['SANDBOX_PAYLOAD'] ?? '';
const profile: Record<string, unknown> = JSON.parse(
  process.env['SANDBOX_CONFIG_JSON'] ?? '{}',
);
try {
  const exitCode = await runBwrapSandbox(
    { ...profile, command: 'bwrap' as const },
    [],
    undefined,
    ['llxprt', '--experimental-acp'],
  );
  fs.writeFileSync('exit-code', String(exitCode));
  process.exit(exitCode);
} catch (error) {
  fs.writeFileSync(
    'launch-error',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(70);
}
