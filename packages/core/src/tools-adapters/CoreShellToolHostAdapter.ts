/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IShellToolHost,
  ShellExecutionResult as ToolsShellExecutionResult,
  ShellOutputEvent as ToolsShellOutputEvent,
} from '@vybestack/llxprt-code-tools';
import { ShellTool } from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import { ShellExecutionService } from '../services/shellExecutionService.js';
import type { ShellOutputEvent } from '../services/shellExecutionService.js';
import { validatePathWithinWorkspace } from '../safety/index.js';
import {
  getCommandRoots,
  isCommandAllowed,
  stripShellWrapper,
} from '../utils/shell-utils.js';
import { isShellInvocationAllowlisted } from '../utils/tool-utils.js';
import type { AnyToolInvocation } from '../index.js';
import { formatMemoryUsage } from '../utils/formatters.js';
import { limitOutputTokens } from '../utils/toolOutputLimiter.js';
import { summarizeToolOutput } from '../utils/summarizer.js';

const DEFAULT_SHELL_TIMEOUT_SECONDS = 300;
const MAX_SHELL_TIMEOUT_SECONDS = 900;

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
    return isCommandAllowed(command, this.config);
  }

  isShellInvocationAllowlisted(command: string): boolean {
    return isShellInvocationAllowlisted(
      { params: { command } } as AnyToolInvocation,
      this.config.getAllowedTools() ?? [],
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

  getTimeoutConfig(): {
    timeoutSeconds: number | undefined;
    defaultTimeoutSeconds: number;
  } {
    const ephemeralSettings = this.config.getEphemeralSettings();
    const defaultTimeoutSeconds =
      (ephemeralSettings['shell-default-timeout-seconds'] as
        | number
        | undefined) ?? DEFAULT_SHELL_TIMEOUT_SECONDS;
    const maxTimeoutSeconds =
      (ephemeralSettings['shell-max-timeout-seconds'] as number | undefined) ??
      MAX_SHELL_TIMEOUT_SECONDS;

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
    };
  }

  getCommandRoots(command: string): string[] {
    return getCommandRoots(command);
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
    const contentGenConfig = this.config.getContentGeneratorConfig();
    if (contentGenConfig?.providerManager === undefined) {
      return content;
    }

    const serverToolsProvider =
      contentGenConfig.providerManager.getServerToolsProvider();
    if (serverToolsProvider == null || serverToolsProvider.name !== 'gemini') {
      return content;
    }

    return summarizeToolOutput(
      content,
      this.config.getGeminiClient(),
      signal,
      tokenBudget,
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

  private mapOutputEvent(event: ShellOutputEvent): ToolsShellOutputEvent {
    switch (event.type) {
      case 'data':
        return {
          type: 'data',
          chunk:
            typeof event.chunk === 'string'
              ? event.chunk
              : JSON.stringify(event.chunk),
        };
      case 'binary_detected':
        return { type: 'binary_detected' };
      case 'binary_progress':
        return { type: 'binary_progress', bytesReceived: event.bytesReceived };
    }
  }
}
