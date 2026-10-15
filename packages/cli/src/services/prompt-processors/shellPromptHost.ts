/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  checkCommandPermissions,
  ShellExecutionService,
  type ShellPermissionConfig,
} from '@vybestack/llxprt-code-core';
import type { CliUiRuntime } from '../../ui/cliUiRuntime.js';
import type { ShellPromptOperations } from './shellProcessor.js';

type ShellPromptOwner = ShellPermissionConfig &
  Pick<
    CliUiRuntime,
    | 'getApprovalMode'
    | 'getShellExecutionConfig'
    | 'getTargetDir'
    | 'getShouldUseNodePtyShell'
  >;

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
