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
  async (t) => {
    // Import TestRig only if on Windows
    const { TestRig } = await import('./test-helper.js');
    const { strict: assert } = await import('assert');

    const rig = new TestRig();
    rig.setup(t.name);

    // Test 1: Verify PowerShell UTF-8 path handling
    const utf8Path = 'テスト.txt';
    const scriptContent = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (Test-Path '${utf8Path}') {
  Write-Host "File exists"
} else {
  Write-Host "File not found"
}
`;
    rig.createFile('check-utf8-path.ps1', scriptContent);
    rig.createFile(utf8Path, 'test content');
    rig.sync();

    const prompt = `Use the run_shell_command tool to execute: powershell -ExecutionPolicy Bypass -File check-utf8-path.ps1`;
    const result = await rig.run(prompt);

    assert.ok(
      result.includes('File exists'),
      `Expected PowerShell to find UTF-8 named file, got: ${result}`,
    );

    // Test 2: Verify stderr encoding from cmd.exe
    const errorPrompt = `Use the run_shell_command tool to execute: cmd /c "dir /invalid-flag 2>&1"`;
    const errorResult = await rig.run(errorPrompt);

    // Should contain some error message (exact text varies by Windows locale)
    assert.ok(
      errorResult.toLowerCase().includes('invalid') ||
        errorResult.toLowerCase().includes('error') ||
        errorResult.includes('/invalid-flag'),
      `Expected cmd.exe error output, got: ${errorResult}`,
    );
  },
  { skip: !isWin, todo: !isWin, description: skipReason },
);
