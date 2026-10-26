#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs';

const pidFile = process.env.PRIMARY_FIXTURE_PID;
if (pidFile) writeFileSync(pidFile, String(process.pid));

switch (process.env.PRIMARY_FIXTURE_MODE) {
  case 'text':
    process.stdout.write(
      JSON.stringify({ args: process.argv.slice(2), text: '😀 café\n最後\n' }),
    );
    break;
  case 'empty':
    process.stderr.write('Nothing is copied\n');
    process.exitCode = 1;
    break;
  case 'error':
    process.stderr.write('PRIVATE backend failure\n');
    process.exitCode = 1;
    break;
  case 'overflow':
    process.stdout.write('x'.repeat(2 * 1024 * 1024));
    break;
  case 'hang':
    process.on('SIGTERM', () => {});
    setTimeout(() => process.exit(0), 4500);
    break;
  default:
    throw new Error('Unknown PRIMARY fixture mode');
}
