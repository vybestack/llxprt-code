/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

const MULTIBYTE = 'ありがとう 世界';

// Deterministic command avoiding echo quirks; ensures exact byte output.

test('run_shell_command handles UTF-8 multibyte output correctly (integration)', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  const prompt = `Execute exactly: printf "${MULTIBYTE}"`;
  const result = rig.run(prompt);

  assert.ok(
    result.includes(MULTIBYTE),
    `Expected output to include "${MULTIBYTE}", got: ${result}`,
  );
});
