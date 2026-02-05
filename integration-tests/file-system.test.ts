/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';

describe('file-system', () => {
  it('should be able to read a file', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to read a file');
    rig.createFile('test.txt', 'hello world');

    const result = await rig.run(
      `read the file test.txt and show me its contents`,
    );

    const foundToolCall = await rig.waitForToolCall('read_file');

    // Add debugging information
    if (!foundToolCall || !result.includes('hello world')) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
        'Contains hello world': result.includes('hello world'),
      });
    }

    expect(
      foundToolCall,
      'Expected to find a read_file tool call',
    ).toBeTruthy();

    // Validate model output - will throw if no output, warn if missing expected content
    validateModelOutput(result, 'hello world', 'File read test');
  });

  it('should perform a read-then-write sequence', async () => {
    const rig = new TestRig();
    await rig.setup('should perform a read-then-write sequence', {
      fakeResponsesPath: join(
        import.meta.dirname,
        'file-system.read-then-write.responses.jsonl',
      ),
    });
    const fileName = 'version.txt';
    rig.createFile(fileName, '1.0.0');

    const prompt = `Read the version from ${fileName} and write the next version 1.0.1 back to the file.`;
    const result = await rig.run(prompt);

    await rig.waitForTelemetryReady();
    const toolLogs = rig.readToolLogs();

    const readCall = toolLogs.find(
      (log) => log.toolRequest.name === 'read_file',
    );
    const writeCall = toolLogs.find(
      (log) =>
        log.toolRequest.name === 'write_file' ||
        log.toolRequest.name === 'replace',
    );

    if (!readCall || !writeCall) {
      printDebugInfo(rig, result, { readCall, writeCall });
    }

    expect(readCall, 'Expected to find a read_file tool call').toBeDefined();
    expect(
      writeCall,
      'Expected to find a write_file or replace tool call',
    ).toBeDefined();

    const newFileContent = rig.readFile(fileName);
    expect(newFileContent).toBe('1.0.1');
  });
});
