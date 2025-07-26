/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

// Skip web search tests in CI when auth type is none
const skipInCI = process.env.LLXPRT_AUTH_TYPE === 'none';
const testFn = skipInCI ? test.skip : test;

testFn('should be able to search the web', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  const prompt = `what planet do we live on`;
  const result = await rig.run(prompt);

  assert.ok(result.toLowerCase().includes('earth'));
});
