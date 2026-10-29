/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendFileSync } from 'node:fs';

const [label, status, marker] = process.argv.slice(2);
if (label === undefined || status === undefined) {
  throw new Error('Expected lint command label and status');
}
if (marker !== undefined) appendFileSync(marker, label + '\n', 'utf8');
if (status === 'hold') {
  // Stay alive until the runner terminates this process; the long timer only
  // bounds a runner that never cancels, which the caller's assertions reject.
  await Bun.sleep(120_000);
}
process.exit(status === 'hold' ? 0 : Number(status));
