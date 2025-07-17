/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

test('should be able to run a shell command', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);
  rig.createFile('blah.txt', 'some content');

  const prompt = `List the files in this directory using ls. Run it from the current directory.`;
  const result = rig.run(prompt);

  assert.ok(result.includes('blah.txt'));
});

test('should be able to run a shell command via stdin', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);
  rig.createFile('blah.txt', 'some content');

  const prompt = `List the files in this directory using ls. Run it from the current directory.`;
  const result = rig.run({ stdin: prompt });

  assert.ok(result.includes('blah.txt'));
});
