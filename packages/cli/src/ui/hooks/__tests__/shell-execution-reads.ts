/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ShellExecutionConfig } from '@vybestack/llxprt-code-core';

export function shellExecutionReads<
  T extends {
    getTargetDir: () => string;
    getShouldUseNodePtyShell: () => boolean;
    getShellExecutionConfig: () => ShellExecutionConfig;
    getPtyTerminalWidth: () => number | undefined;
    getPtyTerminalHeight: () => number | undefined;
  },
>(
  source: T,
): readonly [
  () => string,
  () => boolean,
  () => ShellExecutionConfig,
  () => number | undefined,
  () => number | undefined,
] {
  return [
    () => source.getTargetDir(),
    () => source.getShouldUseNodePtyShell(),
    () => source.getShellExecutionConfig(),
    () => source.getPtyTerminalWidth(),
    () => source.getPtyTerminalHeight(),
  ];
}
