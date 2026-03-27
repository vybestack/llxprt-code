/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import {
  setLlxprtMdFilename as setServerGeminiMdFilename,
  getCurrentLlxprtMdFilename,
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  FileDiscoveryService,
  DebugLogger,
  debugLogger,
  type FileFilteringOptions,
  type GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import { resolvePath } from '../utils/resolvePath.js';
import { isDebugMode } from './environmentLoader.js';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { annotateActiveExtensions } from './extension.js';
import type { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import type { Settings } from './settings.js';
import type { CliArgs } from './cliArgParser.js';

const logger = new DebugLogger('llxprt:config:interactiveContext');

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface ContextResolutionInput {
  readonly argv: CliArgs;
  readonly profileMergedSettings: Settings;
  readonly originalSettings: Settings;
  readonly cwd: string;
  readonly extensions: GeminiCLIExtension[];
  readonly extensionEnablementManager: ExtensionEnablementManager;
}

export interface ContextResolutionResult {
  readonly debugMode: boolean;
  readonly memoryImportFormat: 'flat' | 'tree';
  readonly ideMode: boolean;
  readonly folderTrust: boolean;
  readonly trustedFolder: boolean;
  readonly fileService: FileDiscoveryService;
  readonly fileFiltering: FileFilteringOptions;
  readonly memoryFileFiltering: FileFilteringOptions;
  readonly includeDirectories: readonly string[];
  readonly resolvedLoadMemoryFromIncludeDirectories: boolean;
  readonly jitContextEnabled: boolean;
  readonly interactive: boolean;
  readonly allExtensions: GeminiCLIExtension[];
  readonly activeExtensions: GeminiCLIExtension[];
  readonly extensionContextFilePaths: readonly string[];
}

// ─── Mandatory sub-functions ─────────────────────────────────────────────────

function resolveTrustAndIdeContext(
  input: ContextResolutionInput,
): Pick<
  ContextResolutionResult,
  | 'debugMode'
  | 'memoryImportFormat'
  | 'ideMode'
  | 'folderTrust'
  | 'trustedFolder'
> {
  const { argv, profileMergedSettings, originalSettings } = input;

  const debugMode = isDebugMode(argv);

  const memoryImportFormat =
    profileMergedSettings.ui?.memoryImportFormat || 'tree';

  let ideMode: boolean;
  if (argv.ideMode === 'enable') {
    ideMode = true;
  } else if (argv.ideMode === 'disable') {
    ideMode = false;
  } else {
    ideMode = profileMergedSettings.ui?.ideMode ?? false;
  }

  if (debugMode) {
    debugLogger.debug('[DEBUG] IDE mode configuration:', {
      'argv.ideMode': argv.ideMode,
      'profileMergedSettings.ui.ideMode': profileMergedSettings.ui?.ideMode,
      'final ideMode': ideMode,
    });
  }

  // Trust uses originalSettings (not profile-merged) — security critical
  const folderTrust = originalSettings.folderTrust ?? false;
  const trustedFolder = isWorkspaceTrusted(originalSettings) ?? false;

  return { debugMode, memoryImportFormat, ideMode, folderTrust, trustedFolder };
}

function resolveFiltering(
  profileMergedSettings: Settings,
  cwd: string,
): Pick<ContextResolutionResult, 'fileFiltering' | 'memoryFileFiltering'> & {
  fileService: FileDiscoveryService;
} {
  const memoryFileFiltering = {
    ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
    ...profileMergedSettings.fileFiltering,
  };

  const fileFiltering = {
    ...DEFAULT_FILE_FILTERING_OPTIONS,
    ...profileMergedSettings.fileFiltering,
  };

  // Set the context filename BEFORE loading memory
  if (profileMergedSettings.ui?.contextFileName) {
    setServerGeminiMdFilename(profileMergedSettings.ui.contextFileName);
  } else {
    setServerGeminiMdFilename(getCurrentLlxprtMdFilename());
  }

  const fileService = new FileDiscoveryService(cwd);

  return { fileFiltering, memoryFileFiltering, fileService };
}

function resolveIncludeDirectories(
  argv: CliArgs,
  profileMergedSettings: Settings,
): Pick<
  ContextResolutionResult,
  'includeDirectories' | 'resolvedLoadMemoryFromIncludeDirectories'
> {
  const includeDirectoriesFromSettings =
    profileMergedSettings.includeDirectories || [];
  const includeDirectoriesFromCli = argv.includeDirectories || [];
  const includeDirectories = includeDirectoriesFromSettings
    .map(resolvePath)
    .concat(includeDirectoriesFromCli.map(resolvePath));

  const includeDirectoriesProvided = includeDirectories.length > 0;
  const cliLoadMemoryPreference = argv.loadMemoryFromIncludeDirectories;
  const settingsLoadMemoryPreference =
    profileMergedSettings.loadMemoryFromIncludeDirectories;

  let resolvedLoadMemoryFromIncludeDirectories =
    cliLoadMemoryPreference ?? settingsLoadMemoryPreference ?? false;

  if (
    !resolvedLoadMemoryFromIncludeDirectories &&
    includeDirectoriesProvided &&
    cliLoadMemoryPreference === undefined &&
    settingsLoadMemoryPreference !== true
  ) {
    resolvedLoadMemoryFromIncludeDirectories = true;
  }

  return { includeDirectories, resolvedLoadMemoryFromIncludeDirectories };
}

function resolveExtensions(
  extensions: GeminiCLIExtension[],
  cwd: string,
  manager: ExtensionEnablementManager,
): Pick<
  ContextResolutionResult,
  'allExtensions' | 'activeExtensions' | 'extensionContextFilePaths'
> {
  const allExtensions = annotateActiveExtensions(extensions, cwd, manager);
  const activeExtensions = extensions.filter(
    (_, i) => allExtensions[i].isActive,
  );
  const extensionContextFilePaths = allExtensions
    .filter((ext) => ext.isActive)
    .flatMap((ext) => ext.contextFiles);

  return { allExtensions, activeExtensions, extensionContextFilePaths };
}

function resolveInteractiveMode(argv: CliArgs): boolean {
  const hasPromptWords =
    argv.promptWords && argv.promptWords.some((word) => word.trim() !== '');
  return (
    !!argv.promptInteractive ||
    !!argv.experimentalAcp ||
    (process.stdin.isTTY && !hasPromptWords && !argv.prompt)
  );
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Resolves all context and environment state needed before Config construction.
 * Uses originalSettings for trust checks (security critical).
 */
export function resolveContextAndEnvironment(
  input: ContextResolutionInput,
): ContextResolutionResult {
  const {
    argv,
    profileMergedSettings,
    cwd,
    extensions,
    extensionEnablementManager,
  } = input;

  const trustAndIde = resolveTrustAndIdeContext(input);
  const filtering = resolveFiltering(profileMergedSettings, cwd);
  const includeDirs = resolveIncludeDirectories(argv, profileMergedSettings);
  const extensionData = resolveExtensions(
    extensions,
    cwd,
    extensionEnablementManager,
  );
  const interactive = resolveInteractiveMode(argv);

  const jitContextEnabled =
    profileMergedSettings.experimental?.jitContext ?? true;

  logger.debug(
    () =>
      `Context resolved: debugMode=${trustAndIde.debugMode}, ideMode=${trustAndIde.ideMode}, interactive=${interactive}, jitContext=${jitContextEnabled}`,
  );

  return {
    ...trustAndIde,
    ...filtering,
    ...includeDirs,
    ...extensionData,
    interactive,
    jitContextEnabled,
  };
}
