/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmodSync, existsSync } from 'node:fs';
import { platform } from 'node:os';
import { isDeclarationsOnly } from './build_package.ts';

if (platform() === 'win32') {
  process.exit(0);
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: bun chmod_executable.ts <file>');
  process.exit(1);
}

// The declaration-only build (issue #2983) deliberately emits no JavaScript,
// so the CLI entry this step marks executable does not exist in that mode.
// This is the only case in which an absent target is expected; a full build
// that failed to emit it must still fail loudly.
if (isDeclarationsOnly() && !existsSync(target)) {
  process.exit(0);
}

chmodSync(target, 0o755);
