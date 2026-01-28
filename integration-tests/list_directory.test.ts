/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'vitest';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { existsSync } from 'fs';
import { join } from 'path';

describe('list_directory', () => {
  // Skipping: Windows path validation issue in CI
  it.skip('should be able to list a directory', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to list a directory');
    rig.createFile('file1.txt', 'file 1 content');
    rig.mkdir('subdir');
    rig.sync();

    // Poll for filesystem changes to propagate in containers
    await rig.poll(
      () => {
        // Check if the files exist in the test directory
        const file1Path = join(rig.testDir!, 'file1.txt');
        const subdirPath = join(rig.testDir!, 'subdir');
        return existsSync(file1Path) && existsSync(subdirPath);
      },
      1000, // 1 second max wait
      50, // check every 50ms
    );

    const prompt = `Can you list the files in the current directory. Display them in the style of 'ls'`;

    const result = await rig.run(prompt);

    try {
      await rig.expectToolCallSuccess('list_directory');

      // Validate model output - will throw if no output, warn if missing expected content
      validateModelOutput(
        result,
        ['file1.txt', 'subdir'],
        'List directory test',
      );
    } catch (error) {
      console.error('list_directory test failed');
      const allTools = printDebugInfo(rig, result, {
        'Contains file1.txt': result.includes('file1.txt'),
        'Contains subdir': result.includes('subdir'),
      });

      console.error(
        'List directory calls:',
        allTools
          .filter((t) => t.toolRequest.name === 'list_directory')
          .map((t) => t.toolRequest.args),
      );
      throw error;
    }
  });
});
