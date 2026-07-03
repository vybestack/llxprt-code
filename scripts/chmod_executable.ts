/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmodSync } from 'node:fs';
import { platform } from 'node:os';

if (platform() === 'win32') {
  process.exit(0);
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: bun chmod_executable.ts <file>');
  process.exit(1);
}

chmodSync(target, 0o755);
