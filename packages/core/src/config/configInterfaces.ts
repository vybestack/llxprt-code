/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceContext } from '../utils/workspaceContext.js';
import type { FileFilteringOptions } from './constants.js';
import type { FileExclusions } from '../utils/ignorePatterns.js';
import type { ShellReplacementMode, SandboxConfig } from './configTypes.js';
import type { ShellExecutionConfig } from '../services/shellExecutionService.js';
import type { OutputFormat } from '../utils/output-format.js';
import type { SettingsService } from '../settings/SettingsService.js';
import type { Storage } from './storage.js';

/** Workspace and file path context */
export interface WorkspacePathsConfig {
  getTargetDir(): string;
  getProjectRoot(): string;
  getWorkingDir(): string;
  getWorkspaceContext(): WorkspaceContext;
}

/** File filtering behavior */
export interface FileFilteringConfig {
  getFileFilteringRespectGitIgnore(): boolean;
  getFileFilteringRespectLlxprtIgnore(): boolean;
  getFileFilteringOptions(): FileFilteringOptions;
  getEnableRecursiveFileSearch(): boolean;
  getFileFilteringDisableFuzzySearch(): boolean;
  getCustomExcludes(): string[];
  getFileExclusions(): FileExclusions;
}

/** Shell and PTY execution configuration */
export interface ShellExecutionHostConfig {
  getUseRipgrep(): boolean;
  getShouldUseNodePtyShell(): boolean;
  getAllowPtyThemeOverride(): boolean;
  getPtyScrollbackLimit(): number;
  getPtyTerminalWidth(): number | undefined;
  getPtyTerminalHeight(): number | undefined;
  getShellReplacement(): ShellReplacementMode;
  getShellExecutionConfig(): ShellExecutionConfig;
}

/** Sandbox awareness */
export interface SandboxAwarenessConfig {
  getSandbox(): SandboxConfig | undefined;
  isRestrictiveSandbox(): boolean;
}

/** Debug and output formatting */
export interface DebugOutputConfig {
  getDebugMode(): boolean;
  getOutputFormat(): OutputFormat;
}

/** Read-only settings access (for most consumers) */
export interface SettingsReadConfig {
  getEphemeralSetting(key: string): unknown;
  getSettingsService(): SettingsService;
}

/** Mutable settings access (for runtime/admin code only) */
export interface SettingsMutationConfig extends SettingsReadConfig {
  setEphemeralSetting(key: string, value: unknown): void;
}

/** Memory and context file access */
export interface MemoryContextConfig {
  getUserMemory(): string;
  getLlxprtMdFilePaths(): string[];
  getJitMemoryForPath(targetPath: string): Promise<string>;
}

/** Tool output truncation settings */
export interface ToolOutputConfig {
  getTruncateToolOutputThreshold(): number;
  getTruncateToolOutputLines(): number;
  isToolOutputTruncationEnabled(): boolean;
  getStorage(): Storage;
}
