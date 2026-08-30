/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { ShellTool } from '../src/index.js';
import type {
  IShellToolHost,
  IToolMessageBus,
  ShellExecutionResult,
  BackgroundPromotionResult,
  HostShellJobInfo,
  HostShellJobTailResult,
} from '../src/interfaces/index.js';
import { ToolConfirmationOutcome } from '../src/types/tool-confirmation-types.js';
import type { ToolResult } from '../src/index.js';

/**
 * Focused Bun evidence for issue 2980 REQ-2980-4: when the PTY boundary has
 * normalized a clean exit so that ShellExecutionResult.signal is null, shell
 * tool formatting must report `Signal: (none)` and must NOT emit a
 * "Command terminated by signal" message. A nonzero signal must still be
 * reported verbatim with its termination message.
 *
 * The tool is exercised end-to-end through a minimal IShellToolHost whose
 * executeShellCommand returns the normalized result directly, so the real
 * formatting path (formatNormalOutput) is what is observed.
 */

function createResultHost(
  result: Partial<ShellExecutionResult>,
): IShellToolHost {
  const full: ShellExecutionResult = {
    output: '',
    exitCode: 0,
    signal: null,
    error: null,
    aborted: false,
    pid: undefined,
    ...result,
  };
  return {
    getTargetDir: () => process.cwd(),
    getWorkspaceContext: () => ({
      getDirectories: () => [process.cwd()],
      isPathWithinWorkspace: (resolvedPath: string) =>
        resolvedPath === process.cwd() ||
        resolvedPath.startsWith(`${process.cwd()}/`),
    }),
    isCommandAllowed: () => ({ allowed: true }),
    isShellInvocationAllowlisted: () => false,
    isInteractive: () => true,
    isYoloMode: () => false,
    getDebugMode: () => false,
    getShellExecutionConfig: () => ({
      shouldUseNodePty: false,
      executionOptions: {},
    }),
    getTimeoutConfig: () => ({
      // `-1` is the documented "no ceiling" value; `timeoutSeconds` is always
      // a number per ShellTimeoutConfig, and no timeout path is exercised by
      // these formatting assertions anyway.
      timeoutSeconds: -1,
      defaultTimeoutSeconds: 60,
    }),
    getOutputLimits: () => ({}),
    executeShellCommand: async (): Promise<ShellExecutionResult> => full,
    getCommandRoots: (command: string) => {
      const root = command.trim().split(/\s+/)[0];
      return root ? [root] : [];
    },
    stripShellWrapper: (command: string) => command,
    validatePathWithinWorkspace: () => null,
    isPtyActive: () => false,
    formatMemoryUsage: (bytes: number) =>
      bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`,
    trySummarizeOutput: async (content: string) => content,
    getSummarizeConfig: () => undefined,
    limitOutputTokens: (content: string) => ({
      content,
      wasTruncated: false,
    }),
    launchBackgroundJob: (): HostShellJobInfo => {
      throw new Error('foreground formatting fixture does not launch jobs');
    },
    tailBackgroundJob: (id: string): HostShellJobTailResult => ({
      id,
      output: '',
      truncated: false,
    }),
    detectTrailingBackground: (command: string): BackgroundPromotionResult => ({
      promoted: false,
      command,
    }),
  };
}

function proceedBus(): IToolMessageBus {
  return {
    requestConfirmation: async () => ToolConfirmationOutcome.ProceedOnce,
    publishPolicyUpdate: async () => undefined,
  };
}

async function runShell(
  host: IShellToolHost,
  command: string,
): Promise<ToolResult> {
  const tool = new ShellTool(host, proceedBus());
  return (await tool.execute({ command })) as ToolResult;
}

describe('ShellTool signal formatting (issue 2980)', () => {
  it('reports Signal: (none) and no termination message for a clean exit', async () => {
    const result = await runShell(
      createResultHost({ exitCode: 0, signal: null }),
      'echo clean',
    );

    const llm = String(result.llmContent);
    expect(llm).toContain('Signal: (none)');
    expect(llm).not.toContain('Signal: 0');
    expect(String(result.returnDisplay)).not.toContain(
      'Command terminated by signal',
    );
  });

  it('keeps a nonzero signal and the termination message unchanged', async () => {
    const result = await runShell(
      createResultHost({ exitCode: null, signal: '9' }),
      'echo sig',
    );

    const llm = String(result.llmContent);
    expect(llm).toContain('Signal: 9');
    expect(String(result.returnDisplay)).toContain(
      'Command terminated by signal: 9',
    );
  });
});
