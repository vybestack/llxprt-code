/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [mode, url, marker] = process.argv.slice(2);
if (!url || !marker) throw new Error('Expected gate URL and marker path');

if (mode === 'descendant') {
  process.on('SIGTERM', () => undefined);
  writeFileSync(`${marker}.pid`, String(process.pid));
  process.stdout.write('descendant holding group\n');
  const response = await fetch(`${url}/descendant`);
  if ((await response.text()) === 'release') {
    writeFileSync(marker, 'released\n');
  }
} else if (mode === 'leader') {
  const descendant = spawn(
    process.execPath,
    [process.argv[1], 'descendant', url, marker],
    { stdio: 'ignore' },
  );
  descendant.unref();
  const response = await fetch(`${url}/leader`);
  await response.text();
} else {
  throw new Error('Expected leader or descendant mode');
}
