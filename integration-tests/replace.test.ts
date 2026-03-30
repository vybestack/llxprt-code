/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';

describe('replace', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());
  it('should be able to replace content in a file', async () => {
    await rig.setup('should be able to replace content in a file', {
      settings: { tools: { core: ['replace', 'read_file'] } },
    });

    const fileName = 'file_to_replace.txt';
    const originalContent = 'foo content';
    const expectedContent = 'bar content';

    rig.createFile(fileName, originalContent);

    await rig.run({
      args: `Replace 'foo' with 'bar' in the file 'file_to_replace.txt'`,
    });

    const foundToolCall = await rig.waitForToolCall('replace');
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    expect(rig.readFile(fileName)).toBe(expectedContent);
  });
});
