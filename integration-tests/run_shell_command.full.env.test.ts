/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { focusedToolSettings } from './helpers/focusedToolSettings.js';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { getEnvVarEchoCommand } from './helpers/shellCommandTestSupport.js';

// Real-model scenario split out of run_shell_command.test.ts so each file's
// serial model rounds fit the per-file process budget. The PR E2E workflow
// excludes `run_shell_command.full.*` files; the nightly full run executes them.
describe('run_shell_command environment', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it('should propagate environment variables to the child process', async () => {
    await rig.setup('should propagate environment variables', {
      settings: focusedToolSettings(['run_shell_command']),
    });

    const varName = 'LLXPRT_CODE_TEST_VAR';
    const varValue = `test-value-${Math.random().toString(36).substring(7)}`;
    process.env[varName] = varValue;

    try {
      // The shell tool runs PowerShell on Windows and bash elsewhere; each
      // expands variables with its own syntax, so the prompt names the exact
      // command for the shell the tool will actually use.
      const { command, shellLabel } = getEnvVarEchoCommand(varName);
      const prompt = `Call the run_shell_command tool now with exactly this command: ${command}\nThe tool runs ${shellLabel}, which expands the variable itself, so do not change the syntax. After the tool returns, reply with the exact text it printed.`;
      const result = await rig.run({ args: prompt });

      const foundToolCall = await rig.waitForToolCall('run_shell_command');

      if (!foundToolCall || !result.includes(varValue)) {
        printDebugInfo(rig, result, {
          'Found tool call': foundToolCall,
          'Contains varValue': result.includes(varValue),
        });
      }

      expect(
        foundToolCall,
        'Expected to find a run_shell_command tool call',
      ).toBeTruthy();
      validateModelOutput(result, varValue, 'Env var propagation test');
      expect(result).toContain(varValue);
    } finally {
      delete process.env[varName];
    }
  });
});
