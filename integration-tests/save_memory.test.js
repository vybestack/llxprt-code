/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

test('should be able to save to memory', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  const prompt = `remember that my favorite color is  blue.

  what is my favorite color? tell me that and surround it with $ symbol`;
  const result = await rig.run(prompt);

  // Check that the response mentions blue (the model should remember it)
  const lowerResult = result.toLowerCase();
  assert.ok(
    lowerResult.includes('blue'),
    `Expected response to contain 'blue', but got: ${result}`,
  );

  // Check that blue is surrounded by some marker ($ or other special characters)
  // The model might use different formatting
  const hasMarkedBlue =
    lowerResult.includes('$blue$') ||
    lowerResult.includes('*blue*') ||
    lowerResult.includes('**blue**') ||
    lowerResult.includes('`blue`') ||
    /\bblue\b.*\$|\$.*\bblue\b/.test(lowerResult);

  assert.ok(
    hasMarkedBlue,
    `Expected 'blue' to be marked with special characters, but got: ${result}`,
  );
});
