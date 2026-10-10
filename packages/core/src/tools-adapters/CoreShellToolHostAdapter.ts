import { normalizeShellReplacement } from '../config/configTypes.js';
import type { ToolExecutionPolicy } from '@vybestack/llxprt-code-tools';
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
import type { ShellExecutionConfig } from '../services/shellExecutionService.js';
import type { ShellOutputEvent } from '../services/shellExecutionService.js';
import type { WorkspacePathOperations } from '../services/workspace-filesystem-owner.js';
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

export class CoreShellToolHostAdapter implements IShellToolHost {
  constructor(
    private readonly config: Config,
    private readonly paths: WorkspacePathOperations,
    private readonly readExecution: () => ToolExecutionPolicy,
    private readonly summarizeOutput?: (
      content: string,
      signal: AbortSignal,
      tokenBudget?: number,
    ) => Promise<string>,
  ) {}

  getTargetDir(): string {
    return this.config.getTargetDir();
  }

  workspaceDirectories(): readonly string[] {
    return this.paths.directories();
  }
  containsWorkspacePath(filePath: string): boolean {
    return this.paths.contains(filePath);
  }

  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    return isCommandAllowed(
      command,
      {
        getShellReplacement: () => this.resolveShellReplacement(),
        getExcludeTools: () => this.config.getExcludeTools(),
        getCoreTools: () => this.config.getCoreTools(),
      },
      getShellConfiguration().shell,
    );
  }

  private resolveShellReplacement(): ReturnType<Config['getShellReplacement']> {
    const value = this.readExecution()['shell-replacement'];
    if (value === undefined) return this.config.getShellReplacement();
    if (typeof value === 'boolean') return normalizeShellReplacement(value);
    if (value === 'all' || value === 'none' || value === 'allowlist')
      return normalizeShellReplacement(value);
    return normalizeShellReplacement(undefined);
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

  private readShellAcquisition(): ShellExecutionConfig {
    const declared = this.config.getShellExecutionConfig();
    const policy = this.readExecution();
    const rawSeconds = policy['shell-inactivity-timeout-seconds'];
    const seconds = rawSeconds === undefined ? undefined : Number(rawSeconds);
    const limit = policy['shell-output-retention-max-bytes'];
    let inactivityTimeoutMs = declared.inactivityTimeoutMs;
    if (seconds !== undefined)
      inactivityTimeoutMs = seconds === -1 ? undefined : seconds * 1000;
    return {
      ...declared,
      inactivityTimeoutMs,
      outputRetentionMaxBytes:
        typeof limit === 'number' ? limit : declared.outputRetentionMaxBytes,
    };
  }

  getShellExecutionConfig(): {
    shouldUseNodePty: boolean;
    executionOptions: Record<string, unknown>;
    inactivityTimeoutMs?: number;
    ptyTerminalWidth?: number;
    ptyTerminalHeight?: number;
  } {
    const acquisition = this.readShellAcquisition();
    return {
      shouldUseNodePty: this.config.getShouldUseNodePtyShell(),
      executionOptions: { ...acquisition },
      ptyTerminalWidth: this.config.getPtyTerminalWidth(),
      inactivityTimeoutMs: acquisition.inactivityTimeoutMs,
      ptyTerminalHeight: this.config.getPtyTerminalHeight(),
    };
  }

  getTimeoutConfig(): ShellTimeoutConfig {
    const ephemeralSettings = this.readExecution();
    // Configured default/maximum are validated at the resolution boundary so a
    // bad profile value (0, -2, Infinity, non-numeric) is rejected here rather
    // than flowing unchecked to setTimeout (Finding 2).
    const defaultTimeoutSeconds = readConfiguredTimeoutSeconds(
      { ...ephemeralSettings },
      'shell-default-timeout-seconds',
      DEFAULT_SHELL_TIMEOUT_SECONDS,
    );
    const maxTimeoutSeconds = readConfiguredTimeoutSeconds(
      { ...ephemeralSettings },
      'shell-max-timeout-seconds',
      MAX_SHELL_TIMEOUT_SECONDS,
    );

    return {
      timeoutSeconds: maxTimeoutSeconds,
      defaultTimeoutSeconds,
    };
  }

  getOutputLimits(): { maxTokens?: number; truncateMode?: string } {
    const ephemeralSettings = this.readExecution();
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
        ...this.readShellAcquisition(),
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
      inactivityTimedOut: result.inactivityTimedOut,
      pid: result.pid,
      outputTruncation: result.outputTruncation,
      survivingGroupMembersOnAbort: result.survivingGroupMembersOnAbort,
    };
  }

  getCommandRoots(command: string): string[] {
    return getCommandRoots(command, getShellConfiguration().shell);
  }

  stripShellWrapper(command: string): string {
    return stripShellWrapper(command);
  }

  validatePathWithinWorkspace(dirPath: string, label: string): string | null {
    return this.paths.validate(dirPath, label);
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
    if (this.summarizeOutput === undefined)
      throw new Error(
        'Shell output summarization requires an explicit session client capability',
      );
    return this.summarizeOutput(content, signal, tokenBudget);
  }

  getSummarizeConfig(): { tokenBudget?: number } | undefined {
    return this.config.getSummarizeToolOutputConfig()?.[ShellTool.Name];
  }

  limitOutputTokens(content: string): {
    content: string;
    wasTruncated: boolean;
  } {
    const result = limitOutputTokens(
      content,
      { readExecutionPolicy: this.readExecution },
      ShellTool.Name,
    );
    return {
      content: result.content,
      wasTruncated: result.wasTruncated,
    };
  }

  launchBackgroundJob(input: {
    command: string;
    cwd: string;
  }): ToolsShellJobInfo {
    void input;
    throw new Error('Background jobs require an Agent owner');
  }

  tailBackgroundJob(id: string): ToolsShellJobTailResult {
    void id;
    throw new Error('Background jobs require an Agent owner');
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

function exhaustiveOutputEvent(event: never): ToolsShellOutputEvent {
  throw new Error(`Unhandled shell output event: ${JSON.stringify(event)}`);
}
