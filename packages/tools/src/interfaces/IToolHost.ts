/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for host environment access.
 *
 * Provides target directory, workspace roots, approval mode,
 * interactive state, and feature flag queries needed by
 * file-manipulation and search tools.
 *
 * Consumed by: write-file, insert_at_line, delete_line_range,
 * apply-patch, read_line_range, glob, grep, edit, ast-edit.
 * Implemented by: CoreToolHostAdapter in packages/core.
 */
export type ApprovalMode = 'auto' | 'yolo' | 'default';

export interface IToolHostFileFilteringOptions {
  respectGitIgnore: boolean;
  respectLlxprtIgnore: boolean;
}

export type IToolHostFileFilteringOverrides =
  Partial<IToolHostFileFilteringOptions>;

export interface IToolHostFileService {
  shouldGitIgnoreFile(filePath: string): boolean;
  shouldLlxprtIgnoreFile(filePath: string): boolean;
  shouldIgnoreFile(
    filePath: string,
    opts?: IToolHostFileFilteringOverrides,
  ): boolean;
  filterFiles(
    paths: string[],
    opts?: IToolHostFileFilteringOverrides,
  ): string[];
}

export interface IToolHostFileSystemService {
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
}

export interface IToolHostGitStatsService {
  trackFileEdit(
    filePath: string,
    currentContent: string,
    newContent: string,
  ): Promise<unknown>;
}

export interface IToolHost {
  /** Returns the target directory for file operations. */
  getTargetDir(): string;

  /** Returns the list of workspace root paths. */
  getWorkspaceRoots(): string[];

  /** Returns the current approval mode string. */
  getApprovalMode(): ApprovalMode;

  /** Updates the current approval mode. */
  setApprovalMode(mode: ApprovalMode): void;

  /** Whether the tool is running in interactive mode. */
  isInteractive(): boolean;

  /** Whether a specific feature flag is enabled. */
  hasFeatureFlag(flag: string): boolean;

  /** Returns file discovery/filtering services needed by filesystem tools. */
  getFileService(): IToolHostFileService;

  /** Returns default file filtering options. */
  getFileFilteringOptions(): IToolHostFileFilteringOptions;

  /** Returns glob exclusion patterns. */
  getFileExclusions(): string[];

  /** Returns read-many-files exclusion patterns. */
  getReadManyFilesExclusions(): string[];

  /** Whether .llxprtignore filtering is enabled. */
  getFileFilteringRespectLlxprtIgnore(): boolean;

  /** Returns the absolute path to the .llxprtignore file if it should be used. */
  getLlxprtIgnoreFilePath(): string | null;

  /** Records a file read operation for host telemetry. */
  recordFileRead(filePath: string, lines?: number, mimeType?: string): void;

  /** Returns the filesystem service used for file reads/writes when available. */
  getFileSystemService?(): IToolHostFileSystemService | undefined;

  /** Returns the file-service .llxprtignore patterns when available. */
  getLlxprtIgnorePatterns(): string[];

  /** Returns ephemeral settings used for output limits and feature toggles. */
  getEphemeralSettings(): Record<string, unknown>;

  /** Whether debug logging is enabled. */
  getDebugMode(): boolean;

  /** Whether conversation logging is enabled for metadata collection. */
  getConversationLoggingEnabled?(): boolean;

  /** Returns the git stats service used for edit metadata when enabled. */
  getGitStatsService?(): IToolHostGitStatsService | undefined;

  /** Returns provider server-tools support for tools that delegate to provider-native tools. */
  getServerToolsProvider?(): {
    getServerTools: () => string[];
    invokeServerTool: (
      name: string,
      params: { prompt: string },
      options: { signal: AbortSignal },
    ) => Promise<unknown>;
  } | null;

  /** Whether the host has a provider manager configured. */
  hasProviderManager?(): boolean;
}
