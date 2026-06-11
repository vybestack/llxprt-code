/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

import fs from 'node:fs';

import type {
  ApprovalMode as ToolsApprovalMode,
  IToolHost,
  IToolHostFileFilteringOptions,
  IToolHostFileService,
  IToolHostFileSystemService,
  IToolHostGitStatsService,
} from '@vybestack/llxprt-code-tools';
import { getGitStatsService } from '../services/git-stats-service.js';

import type { Config } from '../config/config.js';
import {
  FileOperation,
  recordFileOperationMetric,
} from '../telemetry/metrics.js';

import { ApprovalMode } from '../config/config.js';

export class CoreToolHostAdapter implements IToolHost {
  constructor(private readonly config: Config) {}

  getTargetDir(): string {
    return this.config.getTargetDir();
  }

  getWorkspaceRoots(): string[] {
    return [...this.config.getWorkspaceContext().getDirectories()];
  }

  getApprovalMode(): ToolsApprovalMode {
    const mode = this.config.getApprovalMode();
    if (mode === ApprovalMode.AUTO_EDIT) {
      return 'auto';
    }
    if (mode === ApprovalMode.YOLO) {
      return 'yolo';
    }
    return 'default';
  }

  setApprovalMode(mode: ToolsApprovalMode): void {
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

  hasFeatureFlag(flag: string): boolean {
    const settings = this.config.getEphemeralSettings();
    return settings[flag] === true;
  }

  getFileService(): IToolHostFileService {
    return this.config.getFileService();
  }

  getFileFilteringOptions(): IToolHostFileFilteringOptions {
    return this.config.getFileFilteringOptions();
  }

  getFileExclusions(): string[] {
    return this.config.getFileExclusions().getGlobExcludes();
  }

  getReadManyFilesExclusions(): string[] {
    return this.config.getFileExclusions().getReadManyFilesExcludes();
  }

  getFileFilteringRespectLlxprtIgnore(): boolean {
    return this.config.getFileFilteringRespectLlxprtIgnore();
  }

  getLlxprtIgnoreFilePath(): string | null {
    const patterns = this.getLlxprtIgnorePatterns();
    if (patterns.length === 0) {
      return null;
    }
    const ignoreFilePath = path.join(
      this.config.getTargetDir(),
      '.llxprtignore',
    );
    return fs.existsSync(ignoreFilePath) ? ignoreFilePath : null;
  }

  recordFileRead(filePath: string, lines?: number, mimeType?: string): void {
    recordFileOperationMetric(
      this.config,
      FileOperation.READ,
      lines,
      mimeType,
      path.extname(filePath),
    );
  }

  getFileSystemService(): IToolHostFileSystemService {
    return this.config.getFileSystemService();
  }

  getLlxprtIgnorePatterns(): string[] {
    const maybeConfig = this.config as unknown as {
      getFileService?: () => { getLlxprtIgnorePatterns?: () => string[] };
    };
    return maybeConfig.getFileService?.().getLlxprtIgnorePatterns?.() ?? [];
  }

  getEphemeralSettings(): Record<string, unknown> {
    return this.config.getEphemeralSettings();
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

  getServerToolsProvider(): {
    getServerTools: () => string[];
    invokeServerTool: (
      name: string,
      params: { prompt: string },
      options: { signal: AbortSignal },
    ) => Promise<unknown>;
  } | null {
    return (
      this.config
        .getContentGeneratorConfig()
        ?.providerManager?.getServerToolsProvider() ?? null
    );
  }

  hasProviderManager(): boolean {
    return this.config.getContentGeneratorConfig()?.providerManager != null;
  }
}
