/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, writeFileSync } from 'node:fs';

const PASS_MESSAGE = 'All native-module smoke checks passed under Bun.';
const HANG_MESSAGE = '[HANG] fixture remains alive';

function pass(): void {
  console.log(PASS_MESSAGE);
}

function hang(): void {
  console.log(HANG_MESSAGE);
  setInterval(() => {}, 60_000);
}

function hangOnce(): void {
  const marker = process.env['SMOKE_FIXTURE_MARKER'];
  if (marker === undefined || marker === '') {
    throw new Error('SMOKE_FIXTURE_MARKER is required for hang-once mode');
  }
  if (existsSync(marker)) {
    pass();
    return;
  }
  writeFileSync(marker, 'first attempt timed out\n');
  hang();
}

switch (process.env['SMOKE_FIXTURE_MODE']) {
  case 'pass':
    pass();
    break;
  case 'fail':
    console.error('[FAIL] fixture check failed');
    process.exitCode = 1;
    break;
  case 'hang':
    hang();
    break;
  case 'hang-once':
    hangOnce();
    break;
  default:
    throw new Error(
      `Unsupported SMOKE_FIXTURE_MODE: ${String(process.env['SMOKE_FIXTURE_MODE'])}`,
    );
}
