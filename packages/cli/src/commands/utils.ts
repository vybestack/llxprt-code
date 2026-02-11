/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runExitCleanup } from '../utils/cleanup.js';

export async function exitCli(exitCode = 0): Promise<never> {
  try {
    await runExitCleanup();
  } finally {
    process.exit(exitCode);
  }
}
