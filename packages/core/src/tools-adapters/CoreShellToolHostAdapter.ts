/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IShellToolHost,
  ShellTimeoutConfig,
  ShellExecutionResult as ToolsShellExecutionResult,
  ShellOutputEvent as ToolsShellOutputEvent,
  HostShellJobInfo as ToolsShellJobInfo,
  HostShellJobTailResult as ToolsShellJobTailResult,
  BackgroundPromotionResult,
} from '@vybestack/llxprt-code-tools';
import {
  ShellTool,
  DEFAULT_SHELL_TIMEOUT_SECONDS,
  MAX_SHELL_TIMEOUT_SECONDS,
} from '@vybestack/llxprt-code-tools';
import { readConfiguredTimeoutSeconds } from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import { ShellExecutionService } from '../services/shellExecutionService.js';
import type { ShellOutputEvent } from '../services/shellExecutionService.js';
import type { ShellJob } from '../services/shellJobManager.js';
import { validatePathWithinWorkspace } from '../safety/index.js';
import {
  getCommandRoots,
  getShellConfiguration,
  isCommandAllowed,
  stripShellWrapper,
} from '../utils/shell-utils.js';
import { detectTrailingBackgroundOperator } from '../utils/shell-parser.js';
import { isShellInvocationAllowlisted } from '../utils/tool-utils.js';
import type { AnyToolInvocation } from '../index.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import { limitOutputTokens } from '../utils/toolOutputLimiter.js';
import { summarizeToolOutput } from '../utils/summarizer.js';

export class CoreShellToolHostAdapter implements IShellToolHost {
  constructor(private readonly config: Config) {}

  getTargetDir(): string {
    return this.config.getTargetDir();
  }

  getWorkspaceContext(): {
    getDirectories(): string[];
    isPathWithinWorkspace(resolvedPath: string): boolean;
  } {
    const workspaceContext = this.config.getWorkspaceContext();
    return {
      getDirectories: () => [...workspaceContext.getDirectories()],
      isPathWithinWorkspace: (resolvedPath: string) =>
        workspaceContext.isPathWithinWorkspace(resolvedPath),
    };
  }

  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    return isCommandAllowed(
      command,
      this.config,
      getShellConfiguration().shell,
    );
  }

  isShellInvocationAllowlisted(command: string): boolean {
    return isShellInvocationAllowlisted(
      { params: { command } } as AnyToolInvocation,
      this.config.getAllowedTools() ?? [],
      getShellConfiguration().shell,
    );
  }

  isInteractive(): boolean {
    return this.config.isInteractive();
  }

  isYoloMode(): boolean {
    return this.config.getApprovalMode() === ApprovalMode.YOLO;
  }

  getDebugMode(): boolean {
    return this.config.getDebugMode();
  }

  getShellExecutionConfig(): {
    shouldUseNodePty: boolean;
    executionOptions: Record<string, unknown>;
    ptyTerminalWidth?: number;
    ptyTerminalHeight?: number;
  } {
    return {
      shouldUseNodePty: this.config.getShouldUseNodePtyShell(),
      executionOptions: this.config.getShellExecutionConfig() as Record<
        string,
        unknown
      >,
      ptyTerminalWidth: this.config.getPtyTerminalWidth(),
      ptyTerminalHeight: this.config.getPtyTerminalHeight(),
    };
  }

  getTimeoutConfig(): ShellTimeoutConfig {
    const ephemeralSettings = this.config.getEphemeralSettings();
    // Configured default/maximum are validated at the resolution boundary so a
    // bad profile value (0, -2, Infinity, non-numeric) is rejected here rather
    // than flowing unchecked to setTimeout (Finding 2).
    const defaultTimeoutSeconds = readConfiguredTimeoutSeconds(
      ephemeralSettings,
      'shell-default-timeout-seconds',
      DEFAULT_SHELL_TIMEOUT_SECONDS,
    );
    const maxTimeoutSeconds = readConfiguredTimeoutSeconds(
      ephemeralSettings,
      'shell-max-timeout-seconds',
      MAX_SHELL_TIMEOUT_SECONDS,
    );

    return {
      timeoutSeconds: maxTimeoutSeconds,
      defaultTimeoutSeconds,
    };
  }

  getOutputLimits(): { maxTokens?: number; truncateMode?: string } {
    const ephemeralSettings = this.config.getEphemeralSettings();
    return {
      maxTokens: ephemeralSettings['tool-output-max-tokens'] as
        | number
        | undefined,
      truncateMode: ephemeralSettings['tool-output-truncate-mode'] as
        | string
        | undefined,
    };
  }

  async executeShellCommand(
    command: string,
    cwd: string,
    onOutput: (event: ToolsShellOutputEvent) => void,
    signal: AbortSignal,
  ): Promise<ToolsShellExecutionResult> {
    const handle = await ShellExecutionService.execute(
      command,
      cwd,
      (event: ShellOutputEvent) => {
        onOutput(this.mapOutputEvent(event));
      },
      signal,
      this.config.getShouldUseNodePtyShell(),
      {
        ...this.config.getShellExecutionConfig(),
        terminalWidth: this.config.getPtyTerminalWidth(),
        terminalHeight: this.config.getPtyTerminalHeight(),
      },
    );
    const result = await handle.result;

    return {
      output: result.output,
      exitCode: result.exitCode,
      signal: result.signal === null ? null : String(result.signal),
      error: result.error,
      aborted: result.aborted,
      pid: result.pid,
      outputTruncation: result.outputTruncation,
    };
  }

  getCommandRoots(command: string): string[] {
    return getCommandRoots(command, getShellConfiguration().shell);
  }

  stripShellWrapper(command: string): string {
    return stripShellWrapper(command);
  }

  validatePathWithinWorkspace(
    _workspaceContext: {
      getDirectories(): string[];
      isPathWithinWorkspace(resolvedPath: string): boolean;
    },
    dirPath: string,
    label: string,
  ): string | null {
    return validatePathWithinWorkspace(
      this.config.getWorkspaceContext(),
      dirPath,
      label,
    );
  }

  isPtyActive(pid: number): boolean {
    return ShellExecutionService.isPtyActive(pid);
  }

  formatMemoryUsage(bytes: number): string {
    return formatMemoryUsage(bytes);
  }

  async trySummarizeOutput(
    content: string,
    signal: AbortSignal,
    tokenBudget?: number,
  ): Promise<string> {
    return summarizeToolOutput(
      content,
      this.config.getAgentClient(),
      signal,
      tokenBudget,
      this.config.getUtilityModel(),
    );
  }

  getSummarizeConfig(): { tokenBudget?: number } | undefined {
    return this.config.getSummarizeToolOutputConfig()?.[ShellTool.Name];
  }

  limitOutputTokens(content: string): {
    content: string;
    wasTruncated: boolean;
  } {
    const result = limitOutputTokens(content, this.config, ShellTool.Name);
    return {
      content: result.content,
      wasTruncated: result.wasTruncated,
    };
  }

  launchBackgroundJob(input: {
    command: string;
    cwd: string;
  }): ToolsShellJobInfo {
    const manager = this.config.getShellJobManager();
    if (manager === undefined) {
      throw new Error(
        'Background jobs are not available (ShellJobManager is not configured).',
      );
    }
    const job = manager.launch({ command: input.command, cwd: input.cwd });
    return toToolsShellJobInfo(job);
  }

  tailBackgroundJob(id: string): ToolsShellJobTailResult {
    const manager = this.config.getShellJobManager();
    if (manager === undefined) {
      throw new Error(
        'Background jobs are not available (ShellJobManager is not configured).',
      );
    }
    return manager.tailOutput(id);
  }

  detectTrailingBackground(command: string): BackgroundPromotionResult {
    const result = detectTrailingBackgroundOperator(command);
    return {
      promoted: result.promoted,
      command: result.command,
    };
  }

  private mapOutputEvent(event: ShellOutputEvent): ToolsShellOutputEvent {
    switch (event.type) {
      case 'data':
        return { type: 'data', chunk: event.chunk };
      case 'binary_detected':
        return { type: 'binary_detected' };
      case 'binary_progress':
        return { type: 'binary_progress', bytesReceived: event.bytesReceived };
      default:
        return exhaustiveOutputEvent(event);
    }
  }
}

function toToolsShellJobInfo(job: ShellJob): ToolsShellJobInfo {
  return {
    id: job.id,
    command: job.command,
    cwd: job.cwd,
    state: job.state,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    pid: job.pid,
    exitCode: job.exitCode,
    signal: job.signal,
    failureReason: job.failureReason,
  };
}

function exhaustiveOutputEvent(event: never): ToolsShellOutputEvent {
  throw new Error(`Unhandled shell output event: ${JSON.stringify(event)}`);
}
