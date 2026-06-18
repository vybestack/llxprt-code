/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** PromptResolver handles hierarchical file resolution for prompt templates. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DebugLogger } from '../debug/DebugLogger.js';
import { type PromptContext } from './types.js';
import {
  fileExists,
  isDirectory,
  isRegularFile,
  walkDirectory,
} from './resolver/fs-adapter.js';
import {
  sanitizePathComponent,
  convertToKebabCase,
} from './resolver/name-utils.js';
import {
  scanBaseDirectory,
  scanProviderOverrides,
} from './resolver/directory-scanner.js';

const logger = new DebugLogger('llxprt:prompt-config:resolver');

export interface ResolveFileResult {
  found: boolean;
  path: string | null;
  source: 'model' | 'provider' | 'base' | null;
}

export interface ResolvedFile {
  type: 'core' | 'env' | 'tool';
  path: string;
  source: 'model' | 'provider' | 'base';
  toolName?: string;
}

export interface AvailableFile {
  path: string;
  type: 'core' | 'env' | 'tool';
  source: 'model' | 'provider' | 'base';
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

type FileSource = 'model' | 'provider' | 'base';

/**
 * PromptResolver handles hierarchical file resolution.
 */
export class PromptResolver {
  /** Find the most specific version of a file. */
  resolveFile(
    baseDir: string,
    relativePath: string,
    context: Partial<PromptContext>,
  ): ResolveFileResult {
    if (!baseDir || !isDirectory(baseDir)) {
      return { found: false, path: null, source: null };
    }

    if (!relativePath || relativePath.includes('..')) {
      return { found: false, path: null, source: null };
    }

    const provider = sanitizePathComponent(context.provider ?? '');
    const model = sanitizePathComponent(context.model ?? '');

    const searchPaths = buildSearchPaths(relativePath, provider, model);

    for (const searchPath of searchPaths) {
      const absolutePath = path.join(baseDir, searchPath);

      if (fileExists(absolutePath) && isRegularFile(absolutePath)) {
        const source = classifySearchPathSource(searchPath);
        return { found: true, path: absolutePath, source };
      }
    }

    return { found: false, path: null, source: null };
  }

  /** Resolve all files for a given context. */
  resolveAllFiles(baseDir: string, context: PromptContext): ResolvedFile[] {
    if (!baseDir) {
      return [];
    }

    const resolvedFiles: ResolvedFile[] = [];

    this.resolveCorePrompt(baseDir, context, resolvedFiles);
    this.resolveEnvironmentPrompts(baseDir, context, resolvedFiles);
    this.resolveToolPrompts(baseDir, context, resolvedFiles);

    return resolvedFiles;
  }

  /** Resolve the core prompt file. */
  private resolveCorePrompt(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    let coreResult = this.resolveFile(baseDir, 'core/default.md', context);
    if (!coreResult.found) {
      coreResult = this.resolveFile(baseDir, 'core.md', context);
    }
    this.addResolvedFile(resolvedFiles, 'core', coreResult);
  }

  /** Resolve environment-specific prompt files. */
  private resolveEnvironmentPrompts(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    this.resolveGitPrompt(baseDir, context, resolvedFiles);
    this.resolveSandboxPrompt(baseDir, context, resolvedFiles);
    this.resolveIdePrompt(baseDir, context, resolvedFiles);
  }

  /** Resolve git repository prompt. */
  private resolveGitPrompt(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    if (!context.environment.isGitRepository) {
      return;
    }
    let gitResult = this.resolveFile(baseDir, 'env/git.md', context);
    if (!gitResult.found) {
      gitResult = this.resolveFile(baseDir, 'env/git-repository.md', context);
    }
    this.addResolvedFile(resolvedFiles, 'env', gitResult);
  }

  /** Resolve sandbox or outside-of-sandbox prompt. */
  private resolveSandboxPrompt(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    if (context.environment.isSandboxed) {
      this.resolveSandboxedPrompt(baseDir, context, resolvedFiles);
    } else {
      this.resolveOutsideSandboxPrompt(baseDir, context, resolvedFiles);
    }
  }

  /** Resolve sandbox-type-specific prompt. */
  private resolveSandboxedPrompt(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    const sandboxPath =
      context.environment.sandboxType === 'macos-seatbelt'
        ? 'env/macos-seatbelt.md'
        : 'env/sandbox.md';
    const result = this.resolveFile(baseDir, sandboxPath, context);
    this.addResolvedFile(resolvedFiles, 'env', result);
  }

  /** Resolve outside-of-sandbox prompt. */
  private resolveOutsideSandboxPrompt(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    const result = this.resolveFile(
      baseDir,
      'env/outside-of-sandbox.md',
      context,
    );
    this.addResolvedFile(resolvedFiles, 'env', result);
  }

  /** Resolve IDE companion prompt. */
  private resolveIdePrompt(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    if (!context.environment.hasIdeCompanion) {
      return;
    }
    const result = this.resolveFile(baseDir, 'env/ide-mode.md', context);
    this.addResolvedFile(resolvedFiles, 'env', result);
  }

  /** Resolve tool prompts (only if enabled via setting, default: false). */
  private resolveToolPrompts(
    baseDir: string,
    context: PromptContext,
    resolvedFiles: ResolvedFile[],
  ): void {
    if (context.enableToolPrompts !== true) {
      return;
    }

    for (const tool of context.enabledTools) {
      if (tool.startsWith('mcp__')) {
        continue;
      }
      this.resolveTool(baseDir, context, tool, resolvedFiles);
    }
  }

  /** Resolve a single tool prompt, trying alternative formats. */
  private resolveTool(
    baseDir: string,
    context: PromptContext,
    tool: string,
    resolvedFiles: ResolvedFile[],
  ): void {
    const toolFileName = convertToKebabCase(tool) + '.md';
    const toolResult = this.resolveFile(
      baseDir,
      'tools/' + toolFileName,
      context,
    );

    if (toolResult.found && toolResult.path && toolResult.source) {
      resolvedFiles.push({
        type: 'tool',
        path: toolResult.path,
        source: toolResult.source,
        toolName: tool,
      });
      return;
    }

    this.tryAlternativeToolFormats(baseDir, context, tool, resolvedFiles);
  }

  /** Try PascalCase and snake_case tool file alternatives. */
  private tryAlternativeToolFormats(
    baseDir: string,
    context: PromptContext,
    tool: string,
    resolvedFiles: ResolvedFile[],
  ): void {
    const pascalCaseFile = tool + '.md';
    const pascalCaseResult = this.resolveFile(
      baseDir,
      'tools/' + pascalCaseFile,
      context,
    );

    if (
      pascalCaseResult.found &&
      pascalCaseResult.path &&
      pascalCaseResult.source
    ) {
      this.addToolFile(resolvedFiles, pascalCaseResult, tool);
      return;
    }

    const snakeCaseFile = this.toSnakeCase(tool) + '.md';
    const snakeCaseResult = this.resolveFile(
      baseDir,
      'tools/' + snakeCaseFile,
      context,
    );

    if (
      snakeCaseResult.found &&
      snakeCaseResult.path &&
      snakeCaseResult.source
    ) {
      this.addToolFile(resolvedFiles, snakeCaseResult, tool);
      return;
    }

    logger.warn(() => `Tool prompt not found: ${tool}`);
  }

  private toSnakeCase(tool: string): string {
    return tool
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  /** Make names filesystem-safe. */
  sanitizePathComponent(component: string): string {
    return sanitizePathComponent(component);
  }

  /** Convert tool names to kebab-case. */
  convertToKebabCase(toolName: string): string {
    return convertToKebabCase(toolName);
  }

  /** List all available prompt files. */
  listAvailableFiles(
    baseDir: string,
    fileType: 'core' | 'env' | 'tool' | 'all',
  ): AvailableFile[] {
    if (!baseDir || !isDirectory(baseDir)) {
      return [];
    }

    const effectiveType = validateFileType(fileType);
    const availableFiles = scanAvailableFiles(baseDir, effectiveType);

    availableFiles.sort((a, b) => {
      const typeOrder = { core: 0, env: 1, tool: 2 };
      const typeCompare = typeOrder[a.type] - typeOrder[b.type];
      if (typeCompare !== 0) return typeCompare;
      return a.path.localeCompare(b.path);
    });

    return availableFiles;
  }

  /** Validate the file structure. */
  validateFileStructure(baseDir: string): ValidationResult {
    let isValid = true;
    const errors: string[] = [];
    const warnings: string[] = [];

    const dirCheck = checkBaseDirectory(baseDir);
    if (!dirCheck.isValid) {
      return {
        isValid: false,
        errors: [...errors, ...dirCheck.errors],
        warnings,
      };
    }

    checkRequiredDirs(baseDir, warnings);
    checkCoreFile(baseDir, errors);
    if (errors.length > 0) isValid = false;

    this.checkFileContents(baseDir, errors, warnings);
    checkCorePermissions(baseDir, errors);
    if (errors.some((e) => e.includes('Cannot read core.md'))) isValid = false;

    return { isValid, errors, warnings };
  }

  /** Check all files for non-md, large files, and invalid filenames. */
  private checkFileContents(
    baseDir: string,
    _errors: string[],
    warnings: string[],
  ): void {
    try {
      walkDirectory(baseDir, (filePath: string, relativePath: string) => {
        checkFileEntry(filePath, relativePath, warnings);
      });
    } catch (error) {
      _errors.push(`File system error: ${error}`);
    }
  }

  /** Add a resolved file to the list if found. */
  private addResolvedFile(
    resolvedFiles: ResolvedFile[],
    type: 'core' | 'env',
    result: ResolveFileResult,
  ): void {
    if (result.found && result.path && result.source) {
      resolvedFiles.push({ type, path: result.path, source: result.source });
    }
  }

  /** Add a resolved tool file to the list if found. */
  private addToolFile(
    resolvedFiles: ResolvedFile[],
    result: ResolveFileResult,
    tool: string,
  ): void {
    if (result.found && result.path && result.source) {
      resolvedFiles.push({
        type: 'tool',
        path: result.path,
        source: result.source,
        toolName: tool,
      });
    }
  }
}

/** Build search paths for file resolution (most specific first). */
function buildSearchPaths(
  relativePath: string,
  provider: string,
  model: string,
): string[] {
  const searchPaths: string[] = [];

  if (provider && model) {
    searchPaths.push(`providers/${provider}/models/${model}/${relativePath}`);
  }

  if (provider) {
    searchPaths.push(`providers/${provider}/${relativePath}`);
  }

  searchPaths.push(relativePath);
  return searchPaths;
}

/** Classify the source type from a search path. */
function classifySearchPathSource(searchPath: string): FileSource {
  if (searchPath.includes('/models/')) {
    return 'model';
  }
  if (searchPath.startsWith('providers/')) {
    return 'provider';
  }
  return 'base';
}

/** Validate file type, defaulting to 'all' if invalid. */
function validateFileType(
  fileType: 'core' | 'env' | 'tool' | 'all',
): 'core' | 'env' | 'tool' | 'all' {
  const validTypes = ['core', 'env', 'tool', 'all'];
  return validTypes.includes(fileType) ? fileType : 'all';
}

/** Scan available files from base and provider directories. */
function scanAvailableFiles(
  baseDir: string,
  fileType: 'core' | 'env' | 'tool' | 'all',
): AvailableFile[] {
  const availableFiles: AvailableFile[] = [];

  try {
    scanBaseDirectory(baseDir, fileType, availableFiles);
    scanProviderOverrides(baseDir, fileType, availableFiles);
  } catch {
    // Permission errors: Skip inaccessible directories
  }

  return availableFiles;
}

/** Check if base directory exists and is a directory. */
function checkBaseDirectory(baseDir: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!fileExists(baseDir)) {
    errors.push('Base directory does not exist');
    return { isValid: false, errors };
  }
  if (!isDirectory(baseDir)) {
    errors.push('Base path is not a directory');
    return { isValid: false, errors };
  }
  return { isValid: true, errors };
}

/** Check for required directories, adding warnings for missing ones. */
function checkRequiredDirs(baseDir: string, warnings: string[]): void {
  const requiredDirs = ['env', 'tools'];
  for (const dir of requiredDirs) {
    const dirPath = path.join(baseDir, dir);
    if (!fileExists(dirPath)) {
      warnings.push(`Missing directory: ${dir}`);
    }
  }
}

/** Check for the core.md file, adding an error if missing. */
function checkCoreFile(baseDir: string, errors: string[]): void {
  const corePath = path.join(baseDir, 'core.md');
  if (!fileExists(corePath)) {
    errors.push('Missing required core.md file');
  }
}

/** Check core.md read permissions. */
function checkCorePermissions(baseDir: string, errors: string[]): void {
  const corePath = path.join(baseDir, 'core.md');
  try {
    if (fileExists(corePath)) {
      fs.accessSync(corePath, fs.constants.R_OK);
    }
  } catch {
    errors.push('Cannot read core.md - check permissions');
  }
}

/** Check a single file entry for non-md, large files, and invalid filenames. */
function checkFileEntry(
  filePath: string,
  relativePath: string,
  warnings: string[],
): void {
  if (!filePath.endsWith('.md')) {
    warnings.push(`Non-markdown file found: ${relativePath}`);
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 10 * 1024 * 1024) {
      warnings.push(`Large file found: ${relativePath}`);
    }
  } catch {
    // Ignore stat errors
  }

  const filename = path.basename(filePath);
  if (!isValidFilename(filename)) {
    warnings.push(`Invalid filename: ${relativePath}`);
  }
}

function isValidFilename(filename: string): boolean {
  return /^[\w\-.]+$/.test(filename);
}
