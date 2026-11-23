/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { drainPromptInstallerNotices } from '@vybestack/llxprt-code-core';
import { recordStartupWarning } from './startupResumeWarnings.js';

/**
 * Record the notices the prompt installer produced while installing the
 * default prompts (kept customized files, prompts that still request a
 * `<scratchpad>`, #4128) as startup warnings, so they reach the user through
 * the same channel as every other startup warning: the TUI in interactive
 * mode, stderr otherwise.
 */
export async function recordPromptInstallerWarnings(
  sink: string[],
): Promise<void> {
  for (const notice of await drainPromptInstallerNotices()) {
    recordStartupWarning(sink, notice);
  }
}
