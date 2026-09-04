/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Source for the portable fake `ps` executable used by sandbox tests.
 *
 * Production's owner-observation probe runs `ps -o lstart= -p <pid>`; the
 * fake answers that exact call shape without depending on a real ps
 * (Git-bash's MSYS ps has no -o). Behavior knobs, all optional env:
 *   LLXPRT_TEST_PS_HANG=1        stall 30s (probe-timeout coverage)
 *   LLXPRT_TEST_PS_OUTPUT        print this fixed line instead of a lookup
 *   LLXPRT_TEST_PROCESS_STARTS   `pid\tstartTimeMs` rows; the requested
 *                                pid's row is formatted as a lstart line
 *
 * The string is compiled into a standalone executable with
 * writePortableExecutable (bun build --compile), so it must stay a single
 * self-contained script with no imports beyond node builtins.
 */
export function psExecutableSource(): string {
  return `#!/usr/bin/env bun
import { readFileSync } from 'node:fs';

if (process.env.LLXPRT_TEST_PS_HANG === '1') {
  await new Promise((resolve) => setTimeout(resolve, 30000));
}
const fixedOutput = process.env.LLXPRT_TEST_PS_OUTPUT;
if (fixedOutput !== undefined) {
  process.stdout.write(fixedOutput + '\\n');
  process.exit(0);
}
const startsPath = process.env.LLXPRT_TEST_PROCESS_STARTS;
const pid = process.argv.at(-1);
if (startsPath === undefined || pid === undefined) process.exit(47);
let processStart: string | undefined;
try {
  processStart = readFileSync(startsPath, 'utf8')
    .split('\\n')
    .find((row) => row.startsWith(pid + '\\t'));
} catch {
  process.exit(50);
}
if (processStart === undefined) process.exit(48);
const startTimeMs = Number(processStart.slice(processStart.indexOf('\\t') + 1));
if (!Number.isFinite(startTimeMs)) process.exit(49);
const date = new Date(startTimeMs);
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const time = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
  .map((part) => String(part).padStart(2, '0'))
  .join(':');
process.stdout.write(weekdays[date.getUTCDay()] + ' ' +
  months[date.getUTCMonth()] + ' ' + String(date.getUTCDate()).padStart(2, ' ') +
  ' ' + time + ' ' + date.getUTCFullYear() + '\\n');
`;
}
