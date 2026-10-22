/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'bun:test';
import { strict as assert } from 'node:assert';
import { focusedToolSettings } from './helpers/focusedToolSettings.js';

const isWin = process.platform === 'win32';

// The Windows shell contract is split across two files, one real-model run
// each, so every case keeps its own budget and rig (see
// run_shell_command.windows.utf8-path.test.ts for the PowerShell half).
it.skipIf(!isWin)(
  'run_shell_command windows (cmd.exe stderr encoding)',
  async () => {
    // Import TestRig only if on Windows
    const { TestRig } = await import('./test-helper.js');

    const rig = new TestRig();
    try {
      rig.setup('run_shell_command windows (cmd.exe stderr encoding)', {
        settings: focusedToolSettings(['run_shell_command']),
      });

      // Verify stderr encoding from cmd.exe
      const errorPrompt = `Run this exact command using the run_shell_command tool: cmd /c "dir /invalid-flag 2>&1"`;
      const errorResult = await rig.run({ args: errorPrompt });

      // Should contain some error message (exact text varies by Windows locale)
      assert.ok(
        errorResult.toLowerCase().includes('invalid') ||
          errorResult.toLowerCase().includes('error') ||
          errorResult.includes('/invalid-flag'),
        `Expected cmd.exe error output, got: ${errorResult}`,
      );
    } finally {
      await rig.cleanup();
    }
  },
);
