/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { getShellConfiguration } from '../packages/core/src/utils/shell-utils.js';

const { shell } = getShellConfiguration();

function getLineCountCommand(): { command: string; tool: string } {
  switch (shell) {
    case 'powershell':
      return {
        command: `(Get-Content test.txt).Length`,
        tool: 'Get-Content',
      };
    case 'cmd':
      return { command: `find /c /v "" test.txt`, tool: 'find' };
    case 'bash':
    default:
      return { command: `wc -l test.txt`, tool: 'wc' };
  }
}

function getFileListingCommand(): { command: string; tool: string } {
  switch (shell) {
    case 'powershell':
      return { command: 'Get-ChildItem -Name', tool: 'Get-ChildItem' };
    case 'cmd':
      return { command: 'dir /b', tool: 'dir' };
    case 'bash':
    default:
      return { command: 'ls -1', tool: 'ls' };
  }
}

function getChainedEchoCommand(): { allowPattern: string; command: string } {
  const secondCommand = getAllowedListCommand();
  switch (shell) {
    case 'powershell':
      return {
        allowPattern: 'Write-Output',
        command: `Write-Output "foo" && ${secondCommand}`,
      };
    case 'cmd':
      return {
        allowPattern: 'echo',
        command: `echo "foo" && ${secondCommand}`,
      };
    case 'bash':
    default:
      return {
        allowPattern: 'echo',
        command: `echo "foo" && ${secondCommand}`,
      };
  }
}

describe('run_shell_command', () => {
  it('should be able to run a shell command', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to run a shell command');

    const prompt = `Please run the command "echo hello-world" (without specifying any directory parameter) and show me the output`;

    const result = await rig.run(prompt);

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
    const rig = new TestRig();
    await rig.setup('should be able to run a shell command via stdin');

    const prompt = `Please run the command "echo test-stdin" (without specifying any directory parameter) and show me what it outputs`;

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
    const rig = new TestRig();
    await rig.setup('should run allowed sub-command in non-interactive mode');

    const testFile = rig.createFile('test.txt', 'Lorem\nIpsum\nDolor\n');
    const { tool } = getLineCountCommand();
    const prompt = `use ${tool} to tell me how many lines there are in ${testFile}`;

    // Use prompt as positional argument instead of stdin for sandbox compatibility.
    // When using stdin with yolo: false in sandbox mode, the stdin data cannot be
    // passed through to the docker container properly.
    const result = await rig.run(
      {
        prompt: prompt,
        yolo: true,
      },
      `--allowed-tools=run_shell_command(${tool})`,
    );

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
      .filter((t) => t.toolRequest.name === 'run_shell_command')[0];
    expect(toolCall.toolRequest.success).toBe(true);
  });

  it('should succeed with no parens in non-interactive mode', async () => {
    const rig = new TestRig();
    await rig.setup('should succeed with no parens in non-interactive mode');

    const testFile = rig.createFile('test.txt', 'Lorem\nIpsum\nDolor\n');
    const { tool } = getLineCountCommand();
    const prompt = `use ${tool} to tell me how many lines there are in ${testFile}`;

    // Use prompt as positional argument instead of stdin for sandbox compatibility.
    const result = await rig.run(
      {
        prompt: prompt,
        yolo: true,
      },
      '--allowed-tools=run_shell_command',
    );

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
      .filter((t) => t.toolRequest.name === 'run_shell_command')[0];
    expect(toolCall.toolRequest.success).toBe(true);
  });

  it('should succeed with --yolo mode', async () => {
    const rig = new TestRig();
    await rig.setup('should succeed with --yolo mode');

    // Use platform-appropriate command
    const isLinux = process.platform === 'linux';
    const prompt = isLinux
      ? `use wc to tell me how many lines there are in /proc/meminfo`
      : `use wc to count how many lines are in /etc/hosts`;
    const expectedText = 'lines';

    const result = await rig.run({
      prompt: prompt,
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
    expect(result).toContain(expectedText);
  });

  it('should work with ShellTool alias', async () => {
    const rig = new TestRig();
    await rig.setup('should work with ShellTool alias');

    // Use platform-appropriate command
    const isLinux = process.platform === 'linux';
    const prompt = isLinux
      ? `use wc to tell me how many lines there are in /proc/meminfo`
      : `use wc to count how many lines are in /etc/hosts`;
    const { tool } = getLineCountCommand();

    // Use prompt as positional argument instead of stdin for sandbox compatibility.
    const result = await rig.run(
      {
        prompt: prompt,
        yolo: true,
      },
      `--allowed-tools=ShellTool(${tool})`,
    );

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
      .filter((t) => t.toolRequest.name === 'run_shell_command')[0];
    expect(toolCall.toolRequest.success).toBe(true);
  });

  it('should combine multiple --allowed-tools flags', async () => {
    const rig = new TestRig();
    await rig.setup('should combine multiple --allowed-tools flags');

    // Use explicit echo commands that work on all platforms (Windows, Linux, macOS).
    // This tests the core feature (combining multiple --allowed-tools flags) without
    // platform-specific command issues or LLM non-determinism from ambiguous prompts.
    const prompt = `Please run the command "echo first-command" and then run the command "echo second-command" and show me both outputs`;

    const result = await rig.run(
      {
        prompt: prompt,
        yolo: true,
      },
      '--allowed-tools=run_shell_command(echo)',
      '--allowed-tools=run_shell_command(echo)',
    );

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
      .filter((t) => t.toolRequest.name === 'run_shell_command')[0];
    expect(toolCall.toolRequest.success).toBe(true);
  });

  // TODO(#11966): Deflake this test and re-enable once the underlying race is resolved.
  it.skip('should reject chained commands when only the first segment is allowlisted in non-interactive mode', async () => {
    const rig = new TestRig();
    await rig.setup(
      'should reject chained commands when only the first segment is allowlisted',
    );

    const chained = getChainedEchoCommand();
    const shellInjection = `!{${chained.command}}`;

    await rig.run(
      {
        stdin: `${shellInjection}\n`,
        yolo: false,
      },
      `--allowed-tools=ShellTool(${chained.allowPattern})`,
    );

    // CLI should refuse to execute the chained command without scheduling run_shell_command.
    const toolLogs = rig
      .readToolLogs()
      .filter((log) => log.toolRequest.name === 'run_shell_command');

    // Success is false because tool is in the scheduled state.
    for (const log of toolLogs) {
      expect(log.toolRequest.success).toBe(false);
      expect(log.toolRequest.args).toContain('&&');
    }
  });

  it('should allow all with "ShellTool" and other specific tools', async () => {
    const rig = new TestRig();
    await rig.setup(
      'should allow all with "ShellTool" and other specific tools',
    );

    const { tool } = getLineCountCommand();
    const prompt = `Please run the command "echo test-allow-all" and show me the output`;

    // Use prompt as positional argument instead of stdin for sandbox compatibility.
    const result = await rig.run(
      {
        prompt: prompt,
        yolo: true,
      },
      `--allowed-tools=run_shell_command(${tool})`,
      '--allowed-tools=run_shell_command',
    );

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

    // Validate model output - will throw if no output, warn if missing expected content
    validateModelOutput(
      result,
      'test-allow-all',
      'Shell command stdin allow all',
    );

    const toolCall = rig
      .readToolLogs()
      .filter((t) => t.toolRequest.name === 'run_shell_command')[0];
    expect(toolCall.toolRequest.success).toBe(true);
  });

  it.skipIf(
    process.env.LLXPRT_SANDBOX !== 'false' || process.platform === 'win32',
  )('should propagate environment variables to the child process', async () => {
    const rig = new TestRig();
    await rig.setup('should propagate environment variables');

    const varName = 'LLXPRT_CODE_TEST_VAR';
    const varValue = `test-value-${Math.random().toString(36).substring(7)}`;
    process.env[varName] = varValue;

    try {
      const prompt = `Use the run_shell_command tool to run "echo $${varName}" and tell me the output.`;
      const result = await rig.run(prompt);

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
    const rig = new TestRig();
    await rig.setup('should run platform-specific file listing');
    const fileName = `test-file-${Math.random().toString(36).substring(7)}.txt`;
    rig.createFile(fileName, 'test content');

    const { command, tool } = getFileListingCommand();
    const prompt = `Use run_shell_command to execute "${command}" in the current directory and tell me if ${fileName} appears in the output. Use the ${tool} command exactly as specified.`;
    const result = await rig.run(
      {
        prompt,
        yolo: false,
      },
      `--allowed-tools=run_shell_command(${tool})`,
    );

    const foundToolCall = await rig.waitForToolCall('run_shell_command');

    // Debugging info
    if (!foundToolCall || !result.includes(fileName)) {
      printDebugInfo(rig, result, {
        'Found tool call': foundToolCall,
        'Contains fileName': result.includes(fileName),
      });
    }

    expect(
      foundToolCall,
      'Expected to find a run_shell_command tool call',
    ).toBeTruthy();

    const toolCall = rig
      .readToolLogs()
      .filter((t) => t.toolRequest.name === 'run_shell_command')[0];
    expect(toolCall.toolRequest.success).toBe(true);

    validateModelOutput(result, fileName, 'Platform-specific listing test');
    expect(result).toContain(fileName);
  });
});
