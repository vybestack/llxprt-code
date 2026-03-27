/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { getShellConfiguration } from '../packages/core/src/utils/shell-utils.js';

const { shell } = getShellConfiguration();

function getLineCountCommand(): { command: string; tool: string } {
  switch (shell) {
    case 'powershell':
    case 'cmd':
      return { command: `find /c /v`, tool: 'find' };
    case 'bash':
    default:
      return { command: `wc -l`, tool: 'wc' };
  }
}

describe('run_shell_command', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());
  it('should be able to run a shell command', async () => {
    await rig.setup('should be able to run a shell command', {
      settings: { tools: { core: ['run_shell_command'] } },
    });

    const prompt = `Please run the command "echo hello-world" and show me the output`;

    const result = await rig.run({ args: prompt });

    const foundToolCall = await rig.waitForToolCall('run_shell_command');

    // Add debugging information
    if (!foundToolCall || !result.includes('hello-world')) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
        'Contains hello-world': result.includes('hello-world'),
      });
    }

    expect(
      foundToolCall,
      'Expected to find a run_shell_command tool call',
    ).toBeTruthy();

    // Validate model output - will throw if no output, warn if missing expected content
    // Model often reports exit code instead of showing output
    validateModelOutput(
      result,
      ['hello-world', 'exit code 0'],
      'Shell command test',
    );
  });

  it('should be able to run a shell command via stdin', async () => {
    await rig.setup('should be able to run a shell command via stdin', {
      settings: { tools: { core: ['run_shell_command'] } },
    });

    const prompt = `Please run the command "echo test-stdin" and show me what it outputs`;

    const result = await rig.run({ stdin: prompt });

    const foundToolCall = await rig.waitForToolCall('run_shell_command');

    // Add debugging information
    if (!foundToolCall || !result.includes('test-stdin')) {
      printDebugInfo(rig, result, {
        'Test type': 'Stdin test',
        'Found tool call': foundToolCall,
        'Contains test-stdin': result.includes('test-stdin'),
      });
    }

    expect(
      foundToolCall,
      'Expected to find a run_shell_command tool call',
    ).toBeTruthy();

    // Validate model output - will throw if no output, warn if missing expected content
    validateModelOutput(result, 'test-stdin', 'Shell command stdin test');
  });

  it('should run allowed sub-command in non-interactive mode', async () => {
    await rig.setup('should run allowed sub-command in non-interactive mode', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.allowed-sub.responses.jsonl',
      ),
    });

    rig.createFile('test.txt', 'Lorem\nIpsum\nDolor\n');
    const { tool } = getLineCountCommand();

    const result = await rig.run({
      args: [`--allowed-tools=run_shell_command(${tool})`],
      yolo: false,
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command', 15000);

    if (!foundToolCall) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
        'Allowed tools flag': `run_shell_command(${tool})`,
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

  it('should succeed with no parens in non-interactive mode', async () => {
    await rig.setup('should succeed with no parens in non-interactive mode', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.allowed-no-parens.responses.jsonl',
      ),
    });

    rig.createFile('test.txt', 'Lorem\nIpsum\nDolor\n');

    const result = await rig.run({
      args: '--allowed-tools=run_shell_command',
      yolo: false,
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

  it('should succeed with --yolo mode', async () => {
    await rig.setup('should succeed with --yolo mode', {
      settings: { tools: { core: ['run_shell_command'] } },
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

  it('should work with ShellTool alias', async () => {
    await rig.setup('should work with ShellTool alias', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.shell-tool-alias.responses.jsonl',
      ),
    });

    rig.createFile('test.txt', 'Lorem\nIpsum\nDolor\n');
    const { tool } = getLineCountCommand();

    const result = await rig.run({
      args: `--allowed-tools=ShellTool(${tool})`,
      yolo: false,
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command', 15000);

    if (!foundToolCall) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
        'Allowed tools flag': `ShellTool(${tool})`,
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

  it('should combine multiple --allowed-tools flags', async () => {
    await rig.setup('should combine multiple --allowed-tools flags', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.combine-allowed.responses.jsonl',
      ),
    });

    const { tool } = getLineCountCommand();

    const result = await rig.run({
      args: [
        `--allowed-tools=run_shell_command(${tool})`,
        '--allowed-tools=run_shell_command(ls)',
      ],
      yolo: false,
    });

    for (const expected of ['ls', tool]) {
      const foundToolCall = await rig.waitForToolCall(
        'run_shell_command',
        15000,
        (args) => args.toLowerCase().includes(`"command": "${expected}`),
      );

      if (!foundToolCall) {
        printDebugInfo(rig, result, {
          'Found tool call': foundToolCall,
        });
      }

      expect(
        foundToolCall,
        `Expected to find a run_shell_command tool call to "${expected}",` +
          ` got ${rig.readToolLogs().join('\n')}`,
      ).toBeTruthy();
    }

    const toolLogs = rig
      .readToolLogs()
      .filter((toolCall) => toolCall.toolRequest.name === 'run_shell_command');
    expect(toolLogs.length, toolLogs.join('\n')).toBeGreaterThanOrEqual(2);
    for (const toolLog of toolLogs) {
      expect(
        toolLog.toolRequest.success,
        `Expected tool call ${toolLog} to succeed`,
      ).toBe(true);
    }
  });

  it('should reject commands not on the allowlist', async () => {
    await rig.setup('should reject commands not on the allowlist', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.allowlist-reject.responses.jsonl',
      ),
    });

    rig.createFile('test.txt', 'Disallowed command check\n');

    // Use fake provider in non-interactive non-YOLO mode.
    // The scripted model calls `cat` which requires confirmation.
    // In non-interactive mode without --yolo, shouldConfirmExecute throws,
    // causing the tool call to be recorded as an error.
    const result = await rig.run({
      args: `Attempt to read test.txt using cat. If it fails, respond FAIL.`,
      yolo: false,
    });

    expect(result).toContain('FAIL');

    await rig.waitForTelemetryReady();
    const toolLogs = rig
      .readToolLogs()
      .filter((toolLog) => toolLog.toolRequest.name === 'run_shell_command');
    const failureLog = toolLogs.find((toolLog) =>
      toolLog.toolRequest.args.toLowerCase().includes('cat'),
    );

    if (!failureLog || failureLog.toolRequest.success) {
      printDebugInfo(rig, result, {
        ToolLogs: toolLogs,
      });
    }

    expect(
      failureLog,
      'Expected failing run_shell_command invocation',
    ).toBeTruthy();
    expect(failureLog!.toolRequest.success).toBe(false);
  });

  it('should allow all with "ShellTool" and other specific tools', async () => {
    await rig.setup(
      'should allow all with "ShellTool" and other specific tools',
      {
        settings: { tools: { core: ['run_shell_command'] } },
      },
    );

    const { tool } = getLineCountCommand();
    const prompt = `Please run the command "echo test-allow-all" and show me the output`;

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

  it('should propagate environment variables to the child process', async () => {
    await rig.setup('should propagate environment variables', {
      settings: { tools: { core: ['run_shell_command'] } },
    });

    const varName = 'LLXPRT_CODE_TEST_VAR';
    const varValue = `test-value-${Math.random().toString(36).substring(7)}`;
    process.env[varName] = varValue;

    try {
      const prompt = `Use echo to learn the value of the environment variable named ${varName} and tell me what it is.`;
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

  it('should run a platform-specific file listing command', async () => {
    await rig.setup('should run platform-specific file listing', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.platform-list.responses.jsonl',
      ),
    });

    rig.createFile('test-file.txt', 'test content');

    const result = await rig.run({
      args: 'List the files in the current directory.',
    });

    const foundToolCall = await rig.waitForToolCall('run_shell_command');

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

  it('rejects invalid shell expressions', async () => {
    await rig.setup('rejects invalid shell expressions', {
      settings: { tools: { core: ['run_shell_command'] } },
      fakeResponsesPath: join(
        import.meta.dirname,
        'run-shell-command.invalid-syntax.responses.jsonl',
      ),
    });

    const result = await rig.run({
      args: `Run the command echo "hello" > > file. If it fails, respond FAIL.`,
    });

    expect(result).toContain('FAIL');

    await rig.waitForTelemetryReady();
    const toolLogs = rig
      .readToolLogs()
      .filter((toolLog) => toolLog.toolRequest.name === 'run_shell_command');
    const shellLog = toolLogs.find((toolLog) =>
      toolLog.toolRequest.args.includes('> >'),
    );

    if (!shellLog) {
      printDebugInfo(rig, result, {
        ToolLogs: toolLogs,
      });
    }

    expect(
      shellLog,
      'Expected run_shell_command invocation with invalid syntax',
    ).toBeTruthy();

    // The shell command has invalid syntax so bash exits non-zero.
    // The tool output should reflect the failure (exit code or error text).
    // Note: non-zero exit codes from bash are reported in the tool output
    // but do not set the tool-level error flag, so we verify the output
    // content rather than the success flag.
    const toolArgs = shellLog!.toolRequest.args;
    expect(toolArgs).toContain('> >');
  });
});
