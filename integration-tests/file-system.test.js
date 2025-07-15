/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { strict as assert } from 'assert';
import { test } from 'node:test';
import { TestRig } from './test-helper.js';

test('reads a file', (t) => {
  const rig = new TestRig();
  rig.setup(t.name);
  rig.createFile('test.txt', 'hello world');

  const output = rig.run(`read the file name test.txt`);

  assert.ok(output.toLowerCase().includes('hello'));
});

test('writes a file', (t) => {
  const rig = new TestRig();
  rig.setup(t.name);
  rig.createFile('test.txt', '');

  // Debug: log the test directory
  console.log('Test directory:', rig.testDir);
  console.log('Working directory:', process.cwd());

  rig.run(`write "Hello World!" to test.txt`);

  // Debug: check if file exists and what's in it
  const fs = require('fs');
  const path = require('path');
  const expectedPath = path.join(rig.testDir, 'test.txt');
  console.log('Expected file path:', expectedPath);
  console.log('File exists:', fs.existsSync(expectedPath));

  const fileContent = rig.readFile('test.txt');
  console.log('File content:', JSON.stringify(fileContent));
  console.log('File length:', fileContent.length);

  assert.ok(fileContent.toLowerCase().includes('hello'));
});
