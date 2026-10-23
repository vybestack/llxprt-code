/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { focusedToolSettings } from './helpers/focusedToolSettings.js';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { getLineCountCommand } from './helpers/shellCommandTestSupport.js';

// Real-model scenario split out of run_shell_command.test.ts so each file's
// serial model rounds fit the per-file process budget. The PR E2E workflow
// excludes `run_shell_command.full.*` files; the nightly full run executes them.
describe('run_shell_command allow-all', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it('should allow all with "ShellTool" and other specific tools', async () => {
    await rig.setup(
      'should allow all with "ShellTool" and other specific tools',
      {
        settings: focusedToolSettings(['run_shell_command']),
      },
    );

    const { tool } = getLineCountCommand('test.txt');
    const prompt = `Call the run_shell_command tool now with exactly this command: echo test-allow-all\nDo not describe the call or print it as JSON; actually invoke the tool. After the tool returns, show me the exact output it printed.`;

    const result = await rig.run({
      args: [
        `--allowed-tools=run_shell_command(${tool})`,
        '--allowed-tools=run_shell_command',
      ],
      stdin: prompt,
      yolo: false,
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command', 15000);

    if (!foundToolCall || !result.includes('test-allow-all')) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
        Result: result,
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

    // Validate model output - will throw if no output, warn if missing expected content
    validateModelOutput(
      result,
      'test-allow-all',
      'Shell command stdin allow all',
    );
  });
});
