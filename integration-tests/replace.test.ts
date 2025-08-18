/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';

describe('replace', () => {
  it.skip('should be able to replace content in a file', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to replace content in a file');

    const fileName = 'file_to_replace.txt';
    const originalContent = 'original content';
    const expectedContent = 'replaced content';

    rig.createFile(fileName, originalContent);
    const prompt = `Use the edit tool to replace the text 'original' with 'replaced' in the file named 'file_to_replace.txt'. The file is in the current directory. Use the edit tool with the file_path parameter set to 'file_to_replace.txt', old_string set to 'original content', and new_string set to 'replaced content'.`;

    const result = await rig.run(prompt);

    // Look for edit tool call (we don't have a 'replace' tool)
    const foundToolCall = await rig.waitForToolCall('edit');

    // Add debugging information
    if (!foundToolCall) {
      printDebugInfo(rig, result);
    }

    expect(foundToolCall, 'Expected to find an edit tool call').toBeTruthy();

    // Validate model output - will throw if no output, warn if missing expected content
    validateModelOutput(
      result,
      ['replaced', 'file_to_replace.txt'],
      'Replace content test',
    );

    const newFileContent = rig.readFile(fileName);

    // Add debugging for file content
    if (newFileContent !== expectedContent) {
      console.error('File content mismatch - Debug info:');
      console.error('Expected:', expectedContent);
      console.error('Actual:', newFileContent);
      console.error(
        'Tool calls:',
        rig.readToolLogs().map((t) => ({
          name: t.toolRequest.name,
          args: t.toolRequest.args,
        })),
      );
    }

    expect(newFileContent).toBe(expectedContent);

    // Log success info if verbose
    if (process.env.VERBOSE === 'true') {
      console.log('File replaced successfully. New content:', newFileContent);
    }
  });
});
