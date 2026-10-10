/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { closeSync, openSync } from 'node:fs';
import { spawnShellJobGroup } from './shellJobGroup.js';

const [mode, logPath] = process.argv.slice(2);
const fd = openSync(logPath, 'w');
const group = spawnShellJobGroup(
  '/bin/sh',
  [
    '-c',
    mode === 'unref'
      ? 'sleep 1; echo orphan-output'
      : 'echo transport-output; exit 7',
  ],
  process.cwd(),
  process.env,
  fd,
);
closeSync(fd);
group.onError((error) => {
  throw error;
});
group.onOwnershipLost((error) => {
  throw error;
});
process.stdout.write(`${group.pid}\n`);
if (mode === 'join') {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    process.stdout.write(`${JSON.stringify(await group.exited)}\n`);
    await group.drained;
  } finally {
    clearInterval(keepAlive);
  }
}
