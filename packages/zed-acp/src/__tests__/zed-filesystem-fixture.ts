/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

export function installZedFilesystemFixture(): () => WorkspaceFilesystemOwner {
  const create = installTestWorkspaceFilesystem();
  let root: WorkspaceFilesystemOwner | undefined;
  afterEach(() => {
    root = undefined;
  });
  return () => {
    root ??= create({ targetDir: process.cwd(), isTrusted: () => true });
    return root;
  };
}
