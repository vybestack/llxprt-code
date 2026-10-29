/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  checkCommandPermissions,
  ShellExecutionService,
  type ApprovalMode,
  type ShellExecutionConfig,
  type ShellPermissionConfig,
} from '@vybestack/llxprt-code-core';
import type { ShellPromptOperations } from './shellProcessor.js';

/**
 * The shell execution state that permission checks and command execution read.
 */
export interface ShellPromptOwner extends ShellPermissionConfig {
  getApprovalMode(): ApprovalMode;
  getShellExecutionConfig(): ShellExecutionConfig;
  getTargetDir(): string;
  getShouldUseNodePtyShell(): boolean;
}

export function bindShellPromptOperations(
  owner: ShellPromptOwner | null,
): ShellPromptOperations | null {
  if (owner === null) return null;
  return {
    checkPermissions: (command, allowlist, shell) =>
      checkCommandPermissions(command, owner, allowlist, shell),
    getApprovalMode: () => owner.getApprovalMode(),
    readShellConfig: () => owner.getShellExecutionConfig(),
    execute: async (command, signal) => {
      const handle = await ShellExecutionService.execute(
        command,
        owner.getTargetDir(),
        () => {},
        signal,
        owner.getShouldUseNodePtyShell(),
        owner.getShellExecutionConfig(),
      );
      return handle.result;
    },
  };
}
