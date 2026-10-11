import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolExecutionPolicy } from '@vybestack/llxprt-code-tools';

import path from 'node:path';

import fs from 'node:fs';

import type {
  ApprovalMode as ToolsApprovalMode,
  IToolHost,
  IToolHostFileFilteringOptions,
  IToolHostFileService,
  IToolHostGitStatsService,
} from '@vybestack/llxprt-code-tools';
import { getGitStatsService } from '../services/git-stats-service.js';
import type {
  WorkspacePathOperations,
  WorkspaceTextOperations,
  WorkspaceScanOperations,
  WorkspaceIgnoreOperations,
} from '../services/workspace-filesystem-owner.js';

import type { WorkspaceTrustReadPort } from '../services/workspace-trust-reader.js';
import { ApprovalMode } from '../config/config.js';

export interface CoreToolHostConfig {
  getSessionId(): string;
  getTargetDir(): string;
  getApprovalMode(): ApprovalMode;
  setApprovalMode(mode: ApprovalMode): void;
  isInteractive(): boolean;
  getFileFilteringOptions(): IToolHostFileFilteringOptions;
  getFileFilteringRespectLlxprtIgnore(): boolean;
  getConversationLoggingEnabled(): boolean;
  getDebugMode(): boolean;
}

export class CoreToolHostAdapter implements IToolHost {
  constructor(
    private readonly config: CoreToolHostConfig,
    private readonly paths: WorkspacePathOperations,
    private readonly files: WorkspaceTextOperations,
    private readonly ignore: WorkspaceIgnoreOperations,
    private readonly scans: WorkspaceScanOperations,
    private readonly readExecution: () => ToolExecutionPolicy,
    private readonly trust: WorkspaceTrustReadPort,
    private readonly telemetry: RootTelemetry | undefined,
  ) {}

  runSearch<T>(
    directories: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.scans.run(directories, operation);
  }

  getTargetDir(): string {
    return this.config.getTargetDir();
  }

  getWorkspaceRoots(): string[] {
    return [...this.paths.directories()];
  }

  getApprovalMode(): ToolsApprovalMode {
    const mode = this.trust.isTrustedFolder()
      ? this.config.getApprovalMode()
      : ApprovalMode.DEFAULT;
    if (mode === ApprovalMode.AUTO_EDIT) {
      return 'auto';
    }
    if (mode === ApprovalMode.YOLO) {
      return 'yolo';
    }
    return 'default';
  }

  setApprovalMode(mode: ToolsApprovalMode): void {
    if (!this.trust.isTrustedFolder() && mode !== 'default')
      throw new Error(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    if (mode === 'auto') {
      this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      return;
    }
    if (mode === 'yolo') {
      this.config.setApprovalMode(ApprovalMode.YOLO);
      return;
    }
    this.config.setApprovalMode(ApprovalMode.DEFAULT);
  }

  isInteractive(): boolean {
    return this.config.isInteractive();
  }

  getFileService(): IToolHostFileService {
    return this.ignore;
  }

  getFileFilteringOptions(): IToolHostFileFilteringOptions {
    return this.config.getFileFilteringOptions();
  }

  getFileExclusions(): string[] {
    return this.ignore.getGlobExcludes();
  }

  getReadManyFilesExclusions(): string[] {
    return this.ignore.getReadManyFilesExcludes();
  }

  getFileFilteringRespectLlxprtIgnore(): boolean {
    return this.config.getFileFilteringRespectLlxprtIgnore();
  }

  getLlxprtIgnoreFilePath(
    directory = this.config.getTargetDir(),
  ): string | null {
    const absolute = fs.realpathSync(directory);
    const root = [...this.paths.directories()]
      .sort((a, b) => b.length - a.length)
      .find((candidate) => {
        const relative = path.relative(candidate, absolute);
        return (
          relative === '' ||
          (relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        );
      });
    if (!root)
      throw new Error('Ignore directory must be within the live workspace');
    const patterns = this.getLlxprtIgnorePatterns(root);
    if (patterns.length === 0) {
      return null;
    }
    const ignoreFilePath = path.join(root, '.llxprtignore');
    return fs.existsSync(ignoreFilePath) ? ignoreFilePath : null;
  }

  recordFileRead(filePath: string, lines?: number, mimeType?: string): void {
    if (this.telemetry === undefined)
      throw new Error('File tools require the selected telemetry root');
    this.telemetry.measurements.fileOperation({
      operation: 'read',
      ...(lines === undefined ? {} : { lines }),
      ...(mimeType === undefined ? {} : { mimetype: mimeType }),
      extension: path.extname(filePath),
      'session.id': this.config.getSessionId(),
    });
  }

  readTextFile(filePath: string): Promise<string> {
    return this.files.readTextFile(filePath);
  }

  writeTextFile(filePath: string, content: string): Promise<void> {
    return this.files.writeTextFile(filePath, content);
  }

  getLlxprtIgnorePatterns(directory?: string): string[] {
    return this.ignore.getLlxprtIgnorePatterns(directory);
  }

  readExecutionPolicy(): ToolExecutionPolicy {
    return this.readExecution();
  }

  getConversationLoggingEnabled(): boolean {
    return this.config.getConversationLoggingEnabled();
  }

  getGitStatsService(): IToolHostGitStatsService | undefined {
    return getGitStatsService() ?? undefined;
  }

  getDebugMode(): boolean {
    return this.config.getDebugMode();
  }
}
