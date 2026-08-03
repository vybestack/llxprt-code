/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IShellToolHost,
  ShellExecutionResult,
  ShellOutputEvent,
  HostShellJobInfo,
  HostShellJobTailResult,
  BackgroundPromotionResult,
} from '@vybestack/llxprt-code-tools';
import type { TerminalManager } from './zed-terminal-manager.js';

export class AcpTerminalShellHost implements IShellToolHost {
  constructor(
    private readonly delegate: IShellToolHost,
    private readonly terminals: TerminalManager,
  ) {}

  getTargetDir(): string {
    return this.delegate.getTargetDir();
  }

  getWorkspaceContext() {
    return this.delegate.getWorkspaceContext();
  }

  isCommandAllowed(command: string) {
    return this.delegate.isCommandAllowed(command);
  }

  isShellInvocationAllowlisted(command: string, toolName: string): boolean {
    return this.delegate.isShellInvocationAllowlisted(command, toolName);
  }

  isInteractive(): boolean {
    return this.delegate.isInteractive();
  }

  isYoloMode(): boolean {
    return this.delegate.isYoloMode();
  }

  getDebugMode(): boolean {
    return this.delegate.getDebugMode();
  }

  getShellExecutionConfig() {
    return this.delegate.getShellExecutionConfig();
  }

  getTimeoutConfig() {
    return this.delegate.getTimeoutConfig();
  }

  getOutputLimits() {
    return this.delegate.getOutputLimits();
  }

  executeShellCommand(
    command: string,
    cwd: string,
    onOutput: (event: ShellOutputEvent) => void,
    signal: AbortSignal,
  ): Promise<ShellExecutionResult> {
    return this.terminals.executeShellCommand(command, cwd, onOutput, signal);
  }

  getCommandRoots(command: string): string[] {
    return this.delegate.getCommandRoots(command);
  }

  stripShellWrapper(command: string): string {
    return this.delegate.stripShellWrapper(command);
  }

  validatePathWithinWorkspace(
    workspaceContext: ReturnType<IShellToolHost['getWorkspaceContext']>,
    dirPath: string,
    label: string,
  ): string | null {
    return this.delegate.validatePathWithinWorkspace(
      workspaceContext,
      dirPath,
      label,
    );
  }

  isPtyActive(pid: number): boolean {
    return this.delegate.isPtyActive(pid);
  }

  formatMemoryUsage(bytes: number): string {
    return this.delegate.formatMemoryUsage(bytes);
  }

  trySummarizeOutput(
    content: string,
    signal: AbortSignal,
    tokenBudget?: number,
  ): Promise<string> {
    return this.delegate.trySummarizeOutput(content, signal, tokenBudget);
  }

  getSummarizeConfig() {
    return this.delegate.getSummarizeConfig();
  }

  limitOutputTokens(content: string) {
    return this.delegate.limitOutputTokens(content);
  }

  launchBackgroundJob(input: {
    command: string;
    cwd: string;
  }): HostShellJobInfo {
    return this.delegate.launchBackgroundJob(input);
  }

  tailBackgroundJob(id: string): HostShellJobTailResult {
    return this.delegate.tailBackgroundJob(id);
  }

  detectTrailingBackground(command: string): BackgroundPromotionResult {
    return this.delegate.detectTrailingBackground(command);
  }
}
