/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';

const isWin = process.platform === 'win32';

const skipReason =
  'Windows-only placeholder validating CP932 decoding and PowerShell UTF-8 path. Skipped on non-Windows.';

(isWin ? test : test.skip)(
  'run_shell_command windows placeholder (CP932 decoding & PowerShell path)',
  async (_t) => {
    // Placeholder: real CI on Windows would validate that a failing cmd.exe emits CP932-encoded stderr
    // and that PowerShell path execution works with UTF-8. This is intentionally minimal.
  },
  { skip: !isWin, todo: !isWin, description: skipReason },
);
