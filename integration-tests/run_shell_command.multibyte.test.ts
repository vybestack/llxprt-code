/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'bun:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

const MULTIBYTE = 'ありがとう 世界';

// Deterministic command avoiding echo quirks; ensures exact byte output.

it.skip('run_shell_command handles UTF-8 multibyte output correctly (integration)', async () => {
  const rig = new TestRig();
  rig.setup(
    'run_shell_command handles UTF-8 multibyte output correctly (integration)',
  );

  // Use single quotes to preserve the space in the multibyte string
  // Use different command for Windows vs Unix
  const isWindows = process.platform === 'win32';
  const command = isWindows
    ? `powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Host '${MULTIBYTE}' -NoNewline"`
    : `printf '${MULTIBYTE}'`;
  const prompt = `Use the run_shell_command tool to execute the following command: ${command}`;
  const result = await rig.run({ args: prompt });

  assert.ok(
    result.includes(MULTIBYTE),
    `Expected output to include "${MULTIBYTE}", got: ${result}`,
  );
});
