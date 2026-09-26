/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TestRig } from './test-helper.js';

describe('replace', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());
  it('should be able to replace content in a file', async () => {
    await rig.setup('should be able to replace content in a file', {
      settings: {
        tools: {
          core: ['replace', 'read_file'],
          exclude: ['run_shell_command'],
        },
      },
    });

    const fileName = 'file_to_replace.txt';
    const originalContent = 'foo content';
    const expectedContent = 'bar content';

    const filePath = rig.createFile(fileName, originalContent);

    await rig.run({
      args: `Use the replace tool on '${filePath}' to replace the exact text 'foo content' with 'bar content'. Do not add any whitespace.`,
    });

    const foundToolCall = await rig.waitForToolCall('replace');
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();
    expect(
      rig
        .readToolLogs()
        .filter(
          (log) => !['replace', 'read_file'].includes(log.toolRequest.name),
        ),
      'Text replacement must not invoke unrelated tools',
    ).toHaveLength(0);

    expect(rig.readFile(fileName)).toBe(expectedContent);
  });
});
