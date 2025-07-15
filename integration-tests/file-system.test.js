/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { strict as assert } from 'assert';
import { test } from 'node:test';
import { TestRig } from './test-helper.js';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

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

  const output = rig.run(`edit test.txt to have a hello world message`);
  console.log('CLI output:', output);

  // Check if any files were created in the test directory
  const files = readdirSync(rig.testDir);
  console.log('Files in test directory:', files);
  for (const file of files) {
    const content = readFileSync(join(rig.testDir, file), 'utf-8');
    console.log(`File ${file} content:`, JSON.stringify(content));
  }

  // Debug: check if file exists and what's in it
  const expectedPath = join(rig.testDir, 'test.txt');
  console.log('Expected file path:', expectedPath);
  console.log('File exists:', existsSync(expectedPath));

  const fileContent = rig.readFile('test.txt');
  console.log('File content:', JSON.stringify(fileContent));
  console.log('File length:', fileContent.length);

  assert.ok(fileContent.toLowerCase().includes('hello'));
});
