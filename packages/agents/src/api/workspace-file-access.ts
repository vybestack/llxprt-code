/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { FileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';

/** Session access to borrowed filesystem resources, without owning their disposal. */
export class WorkspaceFileAccess {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly fileSystem: FileSystemService,
    private readonly isTrusted: () => boolean,
  ) {}

  private assertTrusted(): void {
    if (!this.isTrusted()) {
      throw new Error('Workspace access is denied for an untrusted folder');
    }
  }

  getDirectories(): string[] {
    this.assertTrusted();
    return [...this.context.getDirectories()];
  }

  addDirectory(directory: string): void {
    this.assertTrusted();
    this.context.addDirectory(directory);
  }

  isPathWithinWorkspace(path: string): boolean {
    this.assertTrusted();
    return this.context.isPathWithinWorkspace(path);
  }

  getFileSystemService(): FileSystemService {
    this.assertTrusted();
    return this.fileSystem;
  }
}
