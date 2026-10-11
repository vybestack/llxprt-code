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

/**
 * "Allow for this session" on a shell command is remembered by the ShellTool
 * the session registry owns. The scheduler resolves a fresh session-bound view
 * of that tool (`withBackgroundJobs`) for every call, so every view must share
 * the owning tool's approvals, while an unrelated ShellTool (another session)
 * must not see them.
 */

function createHost(): IShellToolHost {
  const result: ShellExecutionResult = {
    output: '',
    exitCode: 0,
    signal: null,
    error: null,
    aborted: false,
    pid: undefined,
  };
  return {
    getTargetDir: () => process.cwd(),
    workspaceDirectories: () => [process.cwd()],
    containsWorkspacePath: () => true,
    isCommandAllowed: () => ({ allowed: true }),
    isShellInvocationAllowlisted: () => false,
    isInteractive: () => true,
    isYoloMode: () => false,
    getDebugMode: () => false,
    getShellExecutionConfig: () => ({
      shouldUseNodePty: false,
      executionOptions: {},
    }),
    getTimeoutConfig: () => ({ timeoutSeconds: -1, defaultTimeoutSeconds: 60 }),
    getOutputLimits: () => ({}),
    executeShellCommand: async (): Promise<ShellExecutionResult> => result,
    getCommandRoots: (command: string) => {
      const root = command.trim().split(/\s+/)[0];
      return root ? [root] : [];
    },
    stripShellWrapper: (command: string) => command,
    validatePathWithinWorkspace: () => null,
    isPtyActive: () => false,
    formatMemoryUsage: (bytes: number) => `${bytes} bytes`,
    trySummarizeOutput: async (content: string) => content,
    getSummarizeConfig: () => undefined,
    limitOutputTokens: (content: string) => ({
      content,
      wasTruncated: false,
    }),
    launchBackgroundJob: (): HostShellJobInfo => {
      throw new Error('fixture does not launch jobs');
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

function createBus(): IToolMessageBus {
  return {
    requestConfirmation: async () => ToolConfirmationOutcome.ProceedOnce,
    publishPolicyUpdate: async () => undefined,
  };
}

function bindJobs(tool: ShellTool): ShellTool {
  return tool.withBackgroundJobs({
    launchBackgroundJob: (): HostShellJobInfo => {
      throw new Error('fixture does not launch jobs');
    },
    tailBackgroundJob: (id: string): HostShellJobTailResult => ({
      id,
      output: '',
      truncated: false,
    }),
  });
}

async function confirmAlways(tool: ShellTool, command: string): Promise<void> {
  const details = await tool
    .build({ command })
    .shouldConfirmExecute(new AbortController().signal);
  if (details === false) throw new Error('expected a confirmation prompt');
  await details.onConfirm(ToolConfirmationOutcome.ProceedAlways);
}

async function needsConfirmation(
  tool: ShellTool,
  command: string,
): Promise<boolean> {
  const details = await tool
    .build({ command })
    .shouldConfirmExecute(new AbortController().signal);
  return details !== false;
}

describe('ShellTool session allowlist', () => {
  it('shares ProceedAlways approvals across session-bound views of the same tool', async () => {
    const owned = new ShellTool(createHost(), createBus());
    const firstView = bindJobs(owned);

    await confirmAlways(firstView, 'echo first');

    expect(await needsConfirmation(bindJobs(owned), 'echo second')).toBe(false);
    expect(await needsConfirmation(owned, 'echo third')).toBe(false);
    expect(await needsConfirmation(bindJobs(owned), 'ls -la')).toBe(true);
  });

  it('does not leak approvals to another session tool or its views', async () => {
    const sessionA = new ShellTool(createHost(), createBus());
    const sessionB = new ShellTool(createHost(), createBus());

    await confirmAlways(bindJobs(sessionA), 'echo hello');

    expect(await needsConfirmation(bindJobs(sessionB), 'echo hello')).toBe(
      true,
    );
    expect(await needsConfirmation(sessionB, 'echo hello')).toBe(true);
  });
});
