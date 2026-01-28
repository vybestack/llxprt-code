/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmodSync } from 'fs';
import { platform } from 'os';

if (platform() === 'win32') {
  process.exit(0);
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: node chmod_executable.js <file>');
  process.exit(1);
}

chmodSync(target, 0o755);
