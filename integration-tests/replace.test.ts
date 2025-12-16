/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
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

    // Look for replace tool call
    const foundToolCall = await rig.waitForToolCall('replace');

    // Add debugging information
    if (!foundToolCall) {
      printDebugInfo(rig, result);
    }

    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

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

  it('should handle $ literally when replacing text ending with $', async () => {
    const rig = new TestRig();
    await rig.setup(
      'should handle $ literally when replacing text ending with $',
    );

    const fileName = 'regex.yml';
    const originalContent = "| select('match', '^[sv]d[a-z]$')\n";
    const expectedContent = "| select('match', '^[sv]d[a-z]$') # updated\n";

    rig.createFile(fileName, originalContent);

    const prompt =
      "Open regex.yml and append ' # updated' after the line containing ^[sv]d[a-z]$ without breaking the $ character.";

    const result = await rig.run(prompt);
    const foundToolCall = await rig.waitForToolCall('replace');

    if (!foundToolCall) {
      printDebugInfo(rig, result);
    }

    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    validateModelOutput(result, ['regex.yml'], 'Replace $ literal test');

    const newFileContent = rig.readFile(fileName);
    expect(newFileContent).toBe(expectedContent);
  });

  // LLxprt divergence from upstream commit 769fe8b1: We keep this test that upstream deleted.
  // Upstream found it too flaky and removed it entirely. LLxprt fixed the root causes instead
  // (commits 40e85927b, 2bb64333e) with rig.sync(), excludeTools: ['write_file'], and robust
  // file content assertions. This test now reliably validates error handling for missing strings.
  // TODO: Unskip when https://github.com/google-gemini/gemini-cli/issues/10851 is resolved
  it.skip('should fail safely when old_string is not found', async () => {
    const rig = new TestRig();
    await rig.setup('should fail safely when old_string is not found', {
      settings: {
        // Prevent LLM from using write_file to bypass the replace failure
        // This ensures the test is deterministic by restricting available tools
        excludeTools: ['write_file'],
      },
    });
    const fileName = 'no_match.txt';
    const fileContent = 'hello world';
    rig.createFile(fileName, fileContent);

    // Ensure file is flushed to disk before spawning child process
    // This prevents race conditions where the child reads empty/partial content
    rig.sync();

    const prompt = `replace "goodbye" with "farewell" in ${fileName}`;
    await rig.run(prompt);

    await rig.waitForTelemetryReady();
    const toolLogs = rig.readToolLogs();

    const replaceAttempt = toolLogs.find(
      (log) => log.toolRequest.name === 'replace',
    );
    const readAttempt = toolLogs.find(
      (log) => log.toolRequest.name === 'read_file',
    );

    // VERIFY: The model must have at least tried to read the file or perform a replace.
    expect(
      readAttempt || replaceAttempt,
      'Expected model to attempt a read_file or replace',
    ).toBeDefined();

    // CRITICAL ASSERTION FIRST: The file content MUST remain unchanged
    // This is the most robust check - regardless of what tools the LLM called
    // or how it reported success/failure, the file should not be modified.
    const newFileContent = rig.readFile(fileName);
    expect(
      newFileContent,
      `File content was modified! Original: "${fileContent}", Current: "${newFileContent}". ` +
        `This indicates the replace tool succeeded when "goodbye" should not match "hello world".`,
    ).toBe(fileContent);

    // If the model tried to replace, add defensive logging and verify it failed
    if (replaceAttempt) {
      // Defensive logging to help diagnose future flakiness
      if (replaceAttempt.toolRequest.success) {
        console.error('=== FLAKY TEST DIAGNOSTIC INFO ===');
        console.error(
          'The replace tool succeeded when it was expected to fail',
        );
        console.error('Raw tool call args:', replaceAttempt.toolRequest.args);

        // Try to parse and log structured args for better debugging
        try {
          const args = JSON.parse(replaceAttempt.toolRequest.args);
          console.error('Parsed args:', {
            file_path: args.file_path,
            old_string: args.old_string,
            new_string: args.new_string,
            old_string_length: args.old_string?.length,
          });
          console.error(
            `Expected old_string to be "goodbye" but LLM used: "${args.old_string}"`,
          );
        } catch {
          console.error('Failed to parse tool args as JSON');
        }

        console.error(
          'All tool calls:',
          toolLogs.map((t) => t.toolRequest),
        );
        console.error('=== END DIAGNOSTIC INFO ===');
      }

      expect(
        replaceAttempt.toolRequest.success,
        'If replace is called with old_string="goodbye", it must fail because "goodbye" is not in "hello world"',
      ).toBe(false);
    }
  });

  it('should insert a multi-line block of text', async () => {
    const rig = new TestRig();
    await rig.setup('should insert a multi-line block of text');
    const fileName = 'insert_block.txt';
    const originalContent = 'Line A\n<INSERT_TEXT_HERE>\nLine C';
    const newBlock = 'First line\nSecond line\nThird line';
    const expectedContent =
      'Line A\nFirst line\nSecond line\nThird line\nLine C';
    rig.createFile(fileName, originalContent);

    const prompt = `In ${fileName}, replace "<INSERT_TEXT_HERE>" with:\n${newBlock}`;
    const result = await rig.run(prompt);

    const foundToolCall = await rig.waitForToolCall('replace');
    if (!foundToolCall) {
      printDebugInfo(rig, result);
    }
    expect(foundToolCall, 'Expected to find a replace tool call').toBeTruthy();

    const newFileContent = rig.readFile(fileName);

    expect(newFileContent.replace(/\r\n/g, '\n')).toBe(
      expectedContent.replace(/\r\n/g, '\n'),
    );
  });

  it('should delete a block of text', async () => {
    const rig = new TestRig();
    await rig.setup('should delete a block of text');
    const fileName = 'delete_block.txt';
    const blockToDelete =
      '## DELETE THIS ##\nThis is a block of text to delete.\n## END DELETE ##';
    const originalContent = `Hello\n${blockToDelete}\nWorld`;
    const expectedContent = 'Hello\nWorld';
    rig.createFile(fileName, originalContent);

    const prompt = `In ${fileName}, delete the entire block from "## DELETE THIS ##" to "## END DELETE ##" including the markers.`;
    const result = await rig.run(prompt);

    // Model may use either replace tool or delete_line_range tool to delete text
    const foundToolCall = await rig.waitForAnyToolCall([
      'replace',
      'delete_line_range',
    ]);
    if (!foundToolCall) {
      printDebugInfo(rig, result);
    }
    expect(
      foundToolCall,
      'Expected to find a replace or delete_line_range tool call',
    ).toBeTruthy();

    const newFileContent = rig.readFile(fileName);

    expect(newFileContent).toBe(expectedContent);
  });
});
