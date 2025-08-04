/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';
import { chmodSync } from 'fs';

const MULTIBYTE = '\u3042\u308a\u304c\u3068\u3046 \u4e16\u754c';

test('qwen calls a local shell script via run_shell_command and preserves UTF-8 multibyte spacing (integration)', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  // Create a script that prints the exact multibyte string without trailing newline
  // Use different script format for Windows vs Unix
  const isWindows = process.platform === 'win32';
  const scriptName = isWindows ? 'print-multibyte.bat' : 'print-multibyte.sh';
  const scriptContent = isWindows
    ? `@echo off\necho|set /p="${MULTIBYTE}"`
    : `#!/usr/bin/env bash\nprintf "${MULTIBYTE}"`;

  const scriptPath = rig.createFile(scriptName, scriptContent);
  if (!isWindows) {
    chmodSync(scriptPath, 0o755);
  }
  rig.sync();

  // Prompt the model to use the run_shell_command tool explicitly and report stdout exactly
  const prompt = [
    'Use the run_shell_command tool to execute the following command:',
    '',
    isWindows ? `print-multibyte.bat` : `bash print-multibyte.sh`,
    '',
    'Do not specify a directory parameter - run it in the current directory.',
    'After running it, output exactly what the command prints to stdout, with no additional commentary.',
  ].join('\n');

  const result = await rig.run(prompt);

  assert.ok(
    result.includes(MULTIBYTE),
    `Expected output to include "${MULTIBYTE}", got: ${result}`,
  );
});
