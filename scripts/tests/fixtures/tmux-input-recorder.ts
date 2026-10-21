/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFileSync } from 'node:fs';

const destination = process.argv[2];
if (!destination || !process.stdin.isTTY) {
  throw new Error('A recording path and native terminal are required');
}
process.stdin.setRawMode(true);
process.stdout.write(
  '\u001b[?2004hType your shell command\r\nFIXTURE_READY\r\n',
);
process.stdin.on('data', (data: Buffer) => {
  appendFileSync(destination, data);
  if (data.includes(13)) {
    process.stdout.write('NATIVE_INPUT_RECEIVED\r\n');
  }
  if (data.includes(4)) {
    process.stdin.setRawMode(false);
    process.exit(0);
  }
});
