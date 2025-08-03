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
  const scriptPath = rig.createFile(
    'print-multibyte.sh',
    `#!/usr/bin/env bash\nprintf "${MULTIBYTE}"`,
  );
  chmodSync(scriptPath, 0o755);
  rig.sync();

  // Prompt the model to use the run_shell_command tool explicitly and report stdout exactly
  const prompt = [
    'Use the run_shell_command tool to execute the following command:',
    '',
    `./print-multibyte.sh`,
    '',
    'After running it, output exactly what the command prints to stdout, with no additional commentary.',
  ].join('\n');

  const result = rig.run({ prompt });

  assert.ok(
    result.includes(MULTIBYTE),
    `Expected output to include "${MULTIBYTE}", got: ${result}`,
  );
});
