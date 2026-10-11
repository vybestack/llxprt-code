/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';
import { getProjectHash } from '@vybestack/llxprt-code-core';

/**
 * Anything that knows its project root and project temp dir: a Config, or a
 * Storage built straight from the workspace root.
 */
export interface ProjectStorageSource {
  getProjectRoot(): string;
  getProjectTempDir(): string;
}

export interface SessionStorageLocation {
  chatsDir: string;
  projectHash: string;
}

/**
 * The one rule for where this project's session recordings live and how they
 * are tagged: `<projectTempDir>/chats` and the SHA-256 of the project root.
 * Session recording, --list-sessions and --delete-session all derive their
 * location here so they can never disagree.
 */
export function resolveSessionStorageLocation(
  source: ProjectStorageSource,
): SessionStorageLocation {
  return {
    chatsDir: join(source.getProjectTempDir(), 'chats'),
    projectHash: getProjectHash(source.getProjectRoot()),
  };
}
