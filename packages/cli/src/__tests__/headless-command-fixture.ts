/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core';
import {
  createHeadlessCommandRun,
  createHeadlessCommandLoader,
} from '../nonInteractiveBindings.js';
export function handleSlashCommand(
  input: string,
  controller: AbortController,
  config: Config,
  metrics: Parameters<typeof createHeadlessCommandRun>[2],
  trust: (() => boolean) | undefined,
) {
  return createHeadlessCommandRun(
    createHeadlessCommandLoader(
      () => config.userCommandsDir,
      () => config.projectCommandsDir,
      () => config.getProjectRoot(),
      () => config.getExtensions(),
      () => config.getFolderTrust(),
      () => trust,
      () => config.getShellReplacement(),
      () => config.getExcludeTools(),
      () => config.getCoreTools(),
      () => config.getApprovalMode(),
      () => config.getShellExecutionConfig(),
      () => config.getTargetDir(),
      () => config.getShouldUseNodePtyShell(),
    ),
    () => config.getSessionId(),
    metrics,
  )(input, controller);
}
