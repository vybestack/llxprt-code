/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04
 *
 * AgentWorkspaceControl implementation. Delegates to the bound Config's
 * WorkspaceContext so clients access workspace directories without a Config
 * escape hatch.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentWorkspaceControl } from '../agent.js';
import type { WorkspaceFileAccess } from '../workspace-file-access.js';
import type { FileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';

/**
 * Deps bundle injected by AgentImpl so WorkspaceControl can read/write the
 * live Config workspace surface.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04
 */
export interface WorkspaceControlDeps {
  readonly config: Config;
  readonly access?: WorkspaceFileAccess;
}

export class WorkspaceControl implements AgentWorkspaceControl {
  constructor(private readonly deps: WorkspaceControlDeps) {}

  getDirectories(): readonly string[] {
    return (
      this.deps.access?.getDirectories() ??
      this.deps.config.getWorkspaceContext().getDirectories()
    );
  }

  getFileSystemService(): FileSystemService {
    if (this.deps.access === undefined) {
      throw new Error('Session filesystem access was not supplied');
    }
    return this.deps.access.getFileSystemService();
  }

  addDirectory(path: string): void {
    if (this.deps.access) this.deps.access.addDirectory(path);
    else this.deps.config.getWorkspaceContext().addDirectory(path);
  }

  getWorkingDirectory(): string {
    return this.deps.config.getTargetDir();
  }

  getProjectRoot(): string {
    return this.deps.config.getProjectRoot();
  }
}
