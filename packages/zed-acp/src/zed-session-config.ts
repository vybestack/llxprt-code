/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { type Config, isWithinRoot } from '@vybestack/llxprt-code-core';

/**
 * Resolves the effective target directory for a session from an optional
 * client-supplied cwd: a missing/non-string/empty cwd falls back to the config
 * target dir; an absolute or config-relative cwd is accepted only when it
 * resolves WITHIN the config target dir (otherwise the target dir is used), so
 * a session can never escape the project root via lexical traversal (`..`
 * segments are resolved before the containment check).
 *
 * Trust model: the cwd comes from the ACP client (the user's own editor over
 * stdio), which shares the local user's privileges — this guard protects
 * against accidental misconfiguration, not a hostile client. Symlinks inside
 * the project are deliberately NOT realpath-resolved here; a client that can
 * plant symlinks already has direct filesystem access.
 */
export function resolveSessionTargetDir(
  config: Config,
  cwd: string | undefined,
): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    return config.getTargetDir();
  }
  const candidate = path.isAbsolute(cwd)
    ? cwd
    : path.resolve(config.getTargetDir(), cwd);
  return isWithinRoot(candidate, config.getTargetDir())
    ? candidate
    : config.getTargetDir();
}
