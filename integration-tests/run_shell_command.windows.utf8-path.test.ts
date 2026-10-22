/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'bun:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { focusedToolSettings } from './helpers/focusedToolSettings.js';

const isWin = process.platform === 'win32';

// The Windows shell contract is split across two files, one real-model run
// each, so every case keeps its own budget and rig (see
// run_shell_command.windows.cmd-stderr.test.ts for the cmd.exe half).
it.skipIf(!isWin)(
  'run_shell_command windows (PowerShell UTF-8 path)',
  async () => {
    // Import TestRig only if on Windows
    const { TestRig } = await import('./test-helper.js');

    const rig = new TestRig();
    try {
      rig.setup('run_shell_command windows (PowerShell UTF-8 path)', {
        settings: focusedToolSettings(['run_shell_command']),
      });

      // The rig workspace lives under <repo>/.integration-tests/<run-id>/,
      // which the repo-root .gitignore excludes. The agent's file-discovery
      // resolves the enclosing git root (the repo root) and applies its
      // .gitignore, hiding every workspace file from list_directory/glob.
      // Initializing the workspace as its own git repository scopes
      // ignore-rule evaluation to the workspace root so the agent can see the
      // files it is asked to operate on.
      const workspaceDir = rig.testDir;
      assert.ok(workspaceDir, 'rig.setup() must establish a test directory');
      const gitInit = spawnSync('git', ['init'], {
        cwd: workspaceDir,
        encoding: 'utf8',
      });
      assert.equal(
        gitInit.status,
        0,
        `git init failed for the test workspace: ${gitInit.error?.message ?? gitInit.stderr}`,
      );

      // Verify PowerShell UTF-8 path handling
      const utf8Path = 'テスト.txt';
      const scriptContent = `\uFEFF
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

      const prompt = `Run this exact command using the run_shell_command tool: powershell -ExecutionPolicy Bypass -File check-utf8-path.ps1`;
      const result = await rig.run({ args: prompt });

      assert.ok(
        result.includes('File exists'),
        `Expected PowerShell to find UTF-8 named file, got: ${result}`,
      );
    } finally {
      await rig.cleanup();
    }
  },
);
