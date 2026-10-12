/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import {
  WorkspaceFilesystemOwner,
  type WorkspaceFilesystemInputs,
} from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

export function installTestWorkspaceFilesystem(
  settleDisposal?: (disposal: Promise<void>) => Promise<void>,
): (inputs: WorkspaceFilesystemInputs) => WorkspaceFilesystemOwner {
  let roots: readonly WorkspaceFilesystemOwner[] = [];
  afterEach(async () => {
    const closing = roots;
    roots = [];
    const results = await Promise.allSettled(
      closing.map((root) => {
        const disposal = root.dispose();
        return settleDisposal ? settleDisposal(disposal) : disposal;
      }),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Fixture filesystem cleanup failed');
  });
  return (inputs) => {
    const root = new WorkspaceFilesystemOwner(inputs);
    roots = [...roots, root];
    return root;
  };
}

export function installTestWorkspacePaths(
  inputs: WorkspaceFilesystemInputs,
): () => WorkspaceFilesystemOwner['paths'] {
  const createFilesystem = installTestWorkspaceFilesystem();
  let filesystem: WorkspaceFilesystemOwner | undefined;
  afterEach(() => {
    filesystem = undefined;
  });
  return () => {
    filesystem ??= createFilesystem(inputs);
    return filesystem.paths;
  };
}
