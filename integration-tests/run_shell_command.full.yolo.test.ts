/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { focusedToolSettings } from './helpers/focusedToolSettings.js';
import { TestRig, printDebugInfo } from './test-helper.js';
import { getLineCountCommand } from './helpers/shellCommandTestSupport.js';

// Real-model scenario split out of run_shell_command.test.ts so each file's
// serial model rounds fit the per-file process budget. The PR E2E workflow
// excludes `run_shell_command.full.*` files; the nightly full run executes them.
describe('run_shell_command --yolo', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it('should succeed with --yolo mode', async () => {
    await rig.setup('should succeed with --yolo mode', {
      settings: focusedToolSettings(['run_shell_command']),
    });

    const testFile = rig.createFile('test.txt', 'Lorem\nIpsum\nDolor\n');
    const { command } = getLineCountCommand();
    const prompt = `use ${command} to tell me how many lines there are in ${testFile}`;

    const result = await rig.run({
      args: prompt,
      yolo: true,
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command', 15000);

    if (!foundToolCall) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
      });
    }

    expect(
      foundToolCall,
      'Expected to find a run_shell_command tool call',
    ).toBeTruthy();

    const toolCall = rig
      .readToolLogs()
      .filter(
        (toolCall) => toolCall.toolRequest.name === 'run_shell_command',
      )[0];
    expect(toolCall.toolRequest.success).toBe(true);
  });
});
