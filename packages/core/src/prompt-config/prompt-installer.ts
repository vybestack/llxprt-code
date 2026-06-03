/**
 * Prompt Installer - Creates directory structure and installs default prompt files
 * while preserving user customizations.
 *
 * This is a TDD stub implementation. All methods throw "Not implemented" errors.
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import type { Stats } from 'fs';
import { createHash } from 'node:crypto';
import { DebugLogger } from '../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:prompt-config:installer');

// Constants
export const DEFAULT_BASE_DIR = '~/.llxprt/prompts';
export const REQUIRED_DIRECTORIES = [
  '', // Base directory
  'env', // Environment-specific prompts
  'tools', // Tool-specific prompts
  'providers', // Provider overrides
] as const;

// Types
export interface InstallOptions {
  force?: boolean; // Overwrite existing files
  dryRun?: boolean; // Simulate without writing
  verbose?: boolean; // Detailed logging
}

export type PromptConflictReason =
  | 'default-newer'
  | 'user-newer'
  | 'content-diff'
  | 'user-modified'
  | 'user-protected'
  | 'unknown-baseline';

// Manifest file constants
const MANIFEST_FILE = '.installed-manifest.json';
const MANIFEST_VERSION = 1;

// Manifest Zod schema for safe deserialization
const InstalledFileEntrySchema = z.object({
  hash: z.string(),
  installedAt: z.string(),
});

const InstalledManifestSchema = z.object({
  version: z.number(),
  files: z.record(z.string(), InstalledFileEntrySchema),
});

// Manifest type (inferred from schema)
type InstalledManifest = z.infer<typeof InstalledManifestSchema>;

export interface PromptConflictDetails {
  path: string;
  userTimestamp?: string;
  defaultTimestamp?: string;
  reason: PromptConflictReason;
}

export interface PromptConflictSummary extends PromptConflictDetails {
  action: 'kept' | 'overwritten';
  reviewFile?: string;
}

type ExistingFileDecision =
  | { action: 'same' }
  | { action: 'overwrite' }
  | { action: 'keep'; conflict: PromptConflictSummary; notice: string | null }
  | { action: 'resolved' };

export interface InstallResult {
  success: boolean;
  installed: string[];
  skipped: string[];
  errors: string[];
  baseDir?: string;
  conflicts: PromptConflictSummary[];
  notices: string[];
}

export interface UninstallOptions {
  removeUserFiles?: boolean; // Remove all files
  dryRun?: boolean;
}

export interface UninstallResult {
  success: boolean;
  removed: string[];
  errors: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missing: string[];
  baseDir: string;
}

export interface RepairOptions {
  verbose?: boolean;
}

export interface RepairResult {
  success: boolean;
  repaired: string[];
  errors: string[];
  stillInvalid: string[];
}

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  fileCount?: number;
  totalSize?: number;
  error?: string;
}

// Schema for defaults map
export const DefaultsMapSchema = z.record(z.string(), z.string());
export type DefaultsMap = z.infer<typeof DefaultsMapSchema>;

/**
 * PromptInstaller handles installation, validation, and maintenance of prompt files
 */
export class PromptInstaller {
  private defaultSourceDirs: string[] | null = null;

  private async createSingleDir(
    fullPath: string,
    dryRun: boolean | undefined,
    verbose: boolean | undefined,
  ): Promise<string | null> {
    if (dryRun === true) {
      if (verbose === true) {
        logger.debug('Would create:', fullPath);
      }
      return null;
    }

    try {
      await fs.mkdir(fullPath, { recursive: true, mode: 0o755 });
      if (verbose === true) {
        logger.debug('Created directory:', fullPath);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.includes('EACCES') ||
        errorMsg.includes('permission denied')
      ) {
        return `Permission denied: ${fullPath}`;
      }
      return `Failed to create directory ${fullPath}: ${errorMsg}`;
    }
    return null;
  }

  private async createDirectoryStructure(
    expandedBaseDir: string,
    options?: InstallOptions,
  ): Promise<string[]> {
    const errors: string[] = [];

    for (const dir of REQUIRED_DIRECTORIES) {
      const fullPath = path.join(expandedBaseDir, dir);
      const error = await this.createSingleDir(
        fullPath,
        options?.dryRun,
        options?.verbose,
      );
      if (error) errors.push(error);
    }

    return errors;
  }

  private async loadOrCreateManifest(
    expandedBaseDir: string,
    dryRun: boolean,
  ): Promise<InstalledManifest | null> {
    let manifest: InstalledManifest | null = null;
    if (!dryRun && existsSync(expandedBaseDir)) {
      manifest = await this.loadManifest(expandedBaseDir);
    }
    if (!manifest && !dryRun) {
      manifest = { version: MANIFEST_VERSION, files: {} };
    }
    return manifest;
  }

  private async writeInstallFile(
    expandedBaseDir: string,
    relativePath: string,
    content: string,
    manifest: InstalledManifest | null,
    options?: InstallOptions,
  ): Promise<{ installed: boolean; skipped: boolean; error?: string }> {
    const fullPath = path.join(expandedBaseDir, relativePath);

    if (options?.dryRun === true) {
      if (options.verbose === true) {
        logger.debug('Would write:', fullPath);
      }
      return { installed: true, skipped: false };
    }

    const tempPath = `${fullPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`;
    try {
      await fs.writeFile(tempPath, content, { mode: 0o644 });
      try {
        await fs.rename(tempPath, fullPath);
        if (manifest !== null) {
          this.updateManifestEntry(
            manifest,
            relativePath,
            this.hashContent(content),
          );
        }
        if (options?.verbose === true) {
          logger.debug('Installed:', relativePath);
        }
        return { installed: true, skipped: false };
      } catch (renameError) {
        const renameMsg =
          renameError instanceof Error
            ? renameError.message
            : String(renameError);
        if (renameMsg.includes('EEXIST') || existsSync(fullPath)) {
          await fs.unlink(tempPath);
          return { installed: false, skipped: true };
        }
        throw renameError;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      return {
        installed: false,
        skipped: false,
        error: this.classifyWriteError(fullPath, errorMsg),
      };
    }
  }

  private classifyWriteError(fullPath: string, errorMsg: string): string {
    if (errorMsg.includes('EACCES') || errorMsg.includes('Permission denied')) {
      return `Permission denied: ${fullPath}. Try running with elevated permissions or changing the directory ownership.`;
    }
    if (errorMsg.includes('ENOSPC')) {
      return `Disk full: Cannot write ${fullPath}. Free up some disk space and try again.`;
    }
    return `Failed to write ${fullPath}: ${errorMsg}`;
  }

  private async setInstalledPermissions(
    expandedBaseDir: string,
    installed: string[],
    verbose?: boolean,
  ): Promise<void> {
    try {
      await fs.chmod(expandedBaseDir, 0o755);

      for (const dir of REQUIRED_DIRECTORIES) {
        if (dir === '') {
          continue;
        }
        const dirPath = path.join(expandedBaseDir, dir);
        if (existsSync(dirPath)) {
          await fs.chmod(dirPath, 0o755);
        }
      }

      for (const file of installed) {
        const filePath = path.join(expandedBaseDir, file);
        if (existsSync(filePath)) {
          await fs.chmod(filePath, 0o644);
        }
      }
    } catch (error) {
      if (verbose === true) {
        logger.debug('Could not set permissions:', error);
      }
    }
  }

  /**
   * Install default prompt files
   * @param baseDir - Base directory for prompts (defaults to DEFAULT_BASE_DIR)
   * @param defaults - Map of relative path to file content
   * @param options - Installation options
   * @returns Installation result with success status and details
   */
  private async handleExistingFileDecision(
    expandedBaseDir: string,
    relativePath: string,
    fullPath: string,
    content: string,
    options: InstallOptions | undefined,
    manifest: InstalledManifest | null,
  ): Promise<{
    skip: boolean;
    conflict?: PromptConflictSummary;
    notice?: string;
    error?: string;
  } | null> {
    if (!existsSync(fullPath) || options?.force === true) {
      return null;
    }

    const decision = await this.handleExistingFile(
      expandedBaseDir,
      relativePath,
      fullPath,
      content,
      options?.dryRun !== true,
      manifest,
    ).catch((error) => ({
      action: 'same' as const,
      errorMsg: error instanceof Error ? error.message : String(error),
    }));

    if ('errorMsg' in decision) {
      return {
        skip: true,
        error: `Failed to evaluate ${relativePath}: ${decision.errorMsg}`,
      };
    }

    if (decision.action === 'same') {
      return { skip: true };
    }

    if (decision.action === 'resolved') {
      return { skip: true };
    }

    if (decision.action === 'keep') {
      return {
        skip: true,
        conflict: decision.conflict,
        notice: decision.notice ?? undefined,
      };
    }

    // overwrite — not a skip
    if (options?.verbose === true) {
      logger.debug('Updating unmodified file:', relativePath);
    }
    return null;
  }

  private async installFiles(
    expandedBaseDir: string,
    defaults: DefaultsMap,
    manifest: InstalledManifest | null,
    options?: InstallOptions,
  ): Promise<{
    installed: string[];
    skipped: string[];
    errors: string[];
    conflicts: PromptConflictSummary[];
    notices: string[];
  }> {
    const installed: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];
    const conflicts: PromptConflictSummary[] = [];
    const notices: string[] = [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const [relativePath, content] of Object.entries(defaults)) {
      const fullPath = path.join(expandedBaseDir, relativePath);
      const fileDir = path.dirname(fullPath);

      if (!existsSync(fileDir) && options?.dryRun !== true) {
        try {
          await fs.mkdir(fileDir, { recursive: true, mode: 0o755 });
        } catch (error) {
          errors.push(
            `Failed to create directory ${fileDir}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
      }

      const existing = await this.handleExistingFileDecision(
        expandedBaseDir,
        relativePath,
        fullPath,
        content,
        options,
        manifest,
      );
      if (existing?.skip === true) {
        skipped.push(relativePath);
        if (existing.conflict) conflicts.push(existing.conflict);
        if (existing.notice) notices.push(existing.notice);
        if (existing.error) errors.push(existing.error);
        continue;
      }

      const result = await this.writeInstallFile(
        expandedBaseDir,
        relativePath,
        content,
        manifest,
        options,
      );
      if (result.installed) installed.push(relativePath);
      else if (result.skipped) skipped.push(relativePath);
      else if (result.error) errors.push(result.error);
    }

    return { installed, skipped, errors, conflicts, notices };
  }

  async install(
    baseDir: string | null,
    defaults: DefaultsMap,
    options?: InstallOptions,
  ): Promise<InstallResult> {
    const expandedBaseDir = baseDir ?? this.expandPath(DEFAULT_BASE_DIR);

    if (expandedBaseDir.includes('..') || !path.isAbsolute(expandedBaseDir)) {
      return {
        success: false,
        installed: [],
        skipped: [],
        errors: ['Invalid base directory'],
        baseDir: expandedBaseDir,
        conflicts: [],
        notices: [],
      };
    }

    const dirErrors = await this.createDirectoryStructure(
      expandedBaseDir,
      options,
    );
    const manifest = await this.loadOrCreateManifest(
      expandedBaseDir,
      options?.dryRun === true,
    );
    const fileResults = await this.installFiles(
      expandedBaseDir,
      defaults,
      manifest,
      options,
    );
    const errors = [...dirErrors, ...fileResults.errors];

    if (options?.dryRun !== true && errors.length === 0) {
      await this.setInstalledPermissions(
        expandedBaseDir,
        fileResults.installed,
        options?.verbose,
      );
    }

    if (
      options?.dryRun !== true &&
      manifest !== null &&
      fileResults.installed.length > 0
    ) {
      try {
        await this.saveManifest(expandedBaseDir, manifest);
      } catch (error) {
        if (options?.verbose === true) {
          logger.debug('Could not save manifest:', error);
        }
      }
    }

    return {
      success: errors.length === 0,
      installed: fileResults.installed,
      skipped: fileResults.skipped,
      errors,
      baseDir: expandedBaseDir,
      conflicts: fileResults.conflicts,
      notices: fileResults.notices,
    };
  }

  private async handleExistingFile(
    expandedBaseDir: string,
    relativePath: string,
    fullPath: string,
    content: string,
    createReviewCopy: boolean,
    manifest: InstalledManifest | null,
  ): Promise<ExistingFileDecision> {
    const existingContent = await fs.readFile(fullPath, 'utf-8');

    // 1. Content identical - skip (no change needed)
    if (existingContent === content) {
      return { action: 'same' };
    }

    // 2. Check for NO OVERWRITE flag - user explicitly protects this file
    if (this.hasNoOverwriteFlag(existingContent)) {
      return this.createKeepDecision(
        expandedBaseDir,
        relativePath,
        content,
        'user-protected',
        createReviewCopy,
      );
    }

    // 3. Get installed hash to determine if user modified the file
    const installedHash = this.getInstalledHash(manifest, relativePath);
    const currentHash = this.hashContent(existingContent);

    // 4. No manifest entry - first run or corrupt manifest (conservative: assume modified)
    if (installedHash === null) {
      return this.createKeepDecision(
        expandedBaseDir,
        relativePath,
        content,
        'unknown-baseline',
        createReviewCopy,
      );
    }

    // 5. User never modified file - safe to overwrite silently
    if (currentHash === installedHash) {
      return { action: 'overwrite' };
    }

    // 6. User DID modify file - preserve their changes, create review file
    return this.createKeepDecision(
      expandedBaseDir,
      relativePath,
      content,
      'user-modified',
      createReviewCopy,
    );
  }

  /**
   * Create a keep decision with optional review file
   */
  private async createKeepDecision(
    expandedBaseDir: string,
    relativePath: string,
    content: string,
    reason: PromptConflictReason,
    createReviewCopy: boolean,
  ): Promise<ExistingFileDecision> {
    const defaultStats = await this.getDefaultFileStats(relativePath);
    const timestamp = this.getReviewTimestamp(defaultStats);
    const reviewRelativePath = this.generateReviewFilename(
      relativePath,
      timestamp,
    );
    const reviewFullPath = path.join(expandedBaseDir, reviewRelativePath);

    // Check if review file already exists
    if (existsSync(reviewFullPath)) {
      return { action: 'resolved' };
    }

    if (createReviewCopy) {
      await fs.mkdir(path.dirname(reviewFullPath), {
        recursive: true,
        mode: 0o755,
      });
      await fs.writeFile(reviewFullPath, content, { mode: 0o644 });
    }

    const conflict: PromptConflictSummary = {
      path: relativePath,
      action: 'kept',
      reviewFile: reviewRelativePath,
      reason,
    };

    const notice = this.buildConflictNotice(
      path.join(expandedBaseDir, relativePath),
      reviewFullPath,
    );

    return {
      action: 'keep',
      conflict,
      notice,
    };
  }

  private getDefaultSourceDirectories(): string[] {
    if (this.defaultSourceDirs) {
      return this.defaultSourceDirs;
    }

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = new Set<string>();
    candidates.add(path.join(moduleDir, 'defaults'));
    candidates.add(path.join(moduleDir, '..', 'defaults'));
    candidates.add(path.join(moduleDir, '..', '..', 'defaults'));
    candidates.add(
      path.join(moduleDir, '..', '..', 'src', 'prompt-config', 'defaults'),
    );
    candidates.add(path.join(process.cwd(), 'bundle'));
    candidates.add(
      path.join(process.cwd(), 'packages/core/src/prompt-config/defaults'),
    );

    this.defaultSourceDirs = Array.from(candidates);
    return this.defaultSourceDirs;
  }

  private async getDefaultFileStats(
    relativePath: string,
  ): Promise<Stats | null> {
    for (const baseDir of this.getDefaultSourceDirectories()) {
      const candidate = path.join(baseDir, relativePath);
      try {
        const stats = await fs.stat(candidate);
        if (stats.isFile()) {
          return stats;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private generateReviewFilename(
    relativePath: string,
    timestamp: string,
  ): string {
    return `${relativePath}.${timestamp}`;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getUTCFullYear().toString();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  }

  private getReviewTimestamp(defaultStats: Stats | null): string {
    if (defaultStats) {
      return this.formatTimestamp(defaultStats.mtime);
    }
    return this.formatTimestamp(new Date(0));
  }

  private buildConflictNotice(userPath: string, reviewPath: string): string {
    return `Warning: this version includes a newer version of ${userPath} which you customized. We put ${reviewPath} next to it for your review.`;
  }

  private async buildRemovalList(
    expandedBaseDir: string,
    removeUserFiles: boolean,
  ): Promise<string[]> {
    if (removeUserFiles) {
      const toRemove: string[] = [];
      await this.collectAllFiles(expandedBaseDir, expandedBaseDir, toRemove);
      return toRemove;
    }

    const defaultPaths = [
      'core.md',
      'env/development.md',
      'env/dev.md',
      'tools/git.md',
      'providers/openai.md',
    ];
    return Promise.resolve(
      defaultPaths.filter((p) => existsSync(path.join(expandedBaseDir, p))),
    );
  }

  private async removeEmptyDirs(expandedBaseDir: string): Promise<string[]> {
    const removed: string[] = [];
    const dirsToCheck = [...REQUIRED_DIRECTORIES].reverse();

    for (const dir of dirsToCheck) {
      const fullPath =
        dir === '' ? expandedBaseDir : path.join(expandedBaseDir, dir);

      try {
        const contents = await fs.readdir(fullPath);
        if (contents.length === 0) {
          await fs.rmdir(fullPath);
          removed.push(dir === '' ? 'base directory' : dir);
        }
      } catch {
        // Ignore errors when removing directories
      }
    }

    return removed;
  }

  /**
   * Uninstall prompt files
   * @param baseDir - Base directory for prompts
   * @param options - Uninstallation options
   * @returns Uninstallation result with removed files
   */
  async uninstall(
    baseDir: string | null,
    options?: UninstallOptions,
  ): Promise<UninstallResult> {
    const removed: string[] = [];
    const errors: string[] = [];

    const expandedBaseDir = baseDir ?? this.expandPath(DEFAULT_BASE_DIR);

    if (!existsSync(expandedBaseDir)) {
      return { success: true, removed: [], errors: [] };
    }

    let toRemove: string[] = [];
    try {
      toRemove = await this.buildRemovalList(
        expandedBaseDir,
        options?.removeUserFiles === true,
      );
    } catch (error) {
      errors.push(
        `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const file of toRemove) {
      const fullPath = path.join(expandedBaseDir, file);

      if (options?.dryRun === true) {
        logger.debug('Would remove:', fullPath);
        removed.push(file);
      } else {
        try {
          await fs.unlink(fullPath);
          removed.push(file);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line sonarjs/nested-control-flow -- Error classification inside catch is intentionally inline
          if (errorMsg.includes('EBUSY')) {
            errors.push(
              `File in use: ${file}. Close any programs using this file and try again.`,
            );
          } else if (
            errorMsg.includes('EACCES') ||
            errorMsg.includes('Permission denied')
          ) {
            errors.push(`Permission denied: ${file}`);
          } else if (!errorMsg.includes('ENOENT')) {
            errors.push(`Failed to remove ${file}: ${errorMsg}`);
          }
        }
      }
    }

    if (options?.dryRun !== true) {
      const dirRemovals = await this.removeEmptyDirs(expandedBaseDir);
      removed.push(...dirRemovals);
    }

    return { success: errors.length === 0, removed, errors };
  }

  /**
   * Helper method to recursively collect all files in a directory
   */
  private async collectAllFiles(
    baseDir: string,
    currentDir: string,
    files: string[],
  ): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        await this.collectAllFiles(baseDir, fullPath, files);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  private validateDirectoryStructure(
    expandedBaseDir: string,
    errors: string[],
    warnings: string[],
    missing: string[],
  ): void {
    for (const dir of REQUIRED_DIRECTORIES) {
      if (dir === '') continue;

      const fullPath = path.join(expandedBaseDir, dir);
      if (!existsSync(fullPath)) {
        missing.push(dir);
        warnings.push(`Missing directory: ${dir}`);
      }
    }

    const corePath = path.join(expandedBaseDir, 'core.md');
    if (!existsSync(corePath)) {
      missing.push('core.md');
      errors.push('Missing required core.md');
    }
  }

  private async validatePermissions(
    expandedBaseDir: string,
    errors: string[],
    warnings: string[],
  ): Promise<void> {
    try {
      await fs.access(expandedBaseDir, fs.constants.R_OK);
    } catch {
      errors.push('Cannot read from directory');
    }

    try {
      await fs.access(expandedBaseDir, fs.constants.W_OK);
    } catch {
      warnings.push('Cannot write to directory');
    }
  }

  private async validateFileIntegrity(
    filePath: string,
    fileName: string,
    errors: string[],
    warnings: string[],
    isRequired: boolean,
  ): Promise<void> {
    if (!existsSync(filePath)) return;

    try {
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        warnings.push(`Empty file: ${fileName}`);
      }

      try {
        await fs.access(filePath, fs.constants.R_OK);
      } catch {
        errors.push(`Cannot read: ${fileName}`);
      }
    } catch (error) {
      if (isRequired) {
        errors.push(
          `Error checking ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Validate prompt installation
   * @param baseDir - Base directory to validate
   * @returns Validation result with issues found
   */
  async validate(baseDir: string | null): Promise<ValidationResult> {
    const expandedBaseDir = baseDir ?? this.expandPath(DEFAULT_BASE_DIR);

    let isValid = true;
    const errors: string[] = [];
    const warnings: string[] = [];
    const missing: string[] = [];

    if (!existsSync(expandedBaseDir)) {
      errors.push('Base directory does not exist');
      isValid = false;
      return { isValid, errors, warnings, missing, baseDir: expandedBaseDir };
    }

    this.validateDirectoryStructure(expandedBaseDir, errors, warnings, missing);
    if (errors.length > 0) isValid = false;

    await this.validatePermissions(expandedBaseDir, errors, warnings);
    if (errors.some((e) => e.includes('Cannot read'))) isValid = false;

    const errorsBeforeCoreIntegrity = errors.length;
    const corePath = path.join(expandedBaseDir, 'core.md');
    await this.validateFileIntegrity(
      corePath,
      'core.md',
      errors,
      warnings,
      true,
    );
    const coreIntegrityErrors = errors.slice(errorsBeforeCoreIntegrity);
    if (
      coreIntegrityErrors.some(
        (error) =>
          error.includes('core.md') && !error.startsWith('Cannot read:'),
      )
    ) {
      isValid = false;
    }

    const defaultFiles = [
      'env/development.md',
      'tools/git.md',
      'providers/openai.md',
    ];
    for (const file of defaultFiles) {
      await this.validateFileIntegrity(
        path.join(expandedBaseDir, file),
        file,
        errors,
        warnings,
        false,
      );
    }

    return { isValid, errors, warnings, missing, baseDir: expandedBaseDir };
  }

  private async repairMissingDirs(
    expandedBaseDir: string,
    missing: string[],
    verbose?: boolean,
  ): Promise<{ repaired: string[]; errors: string[] }> {
    const repaired: string[] = [];
    const errors: string[] = [];

    for (const missingItem of missing) {
      if (
        !REQUIRED_DIRECTORIES.includes(
          missingItem as (typeof REQUIRED_DIRECTORIES)[number],
        )
      ) {
        continue;
      }
      const dirPath = path.join(expandedBaseDir, missingItem);
      try {
        await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
        repaired.push(missingItem);
        if (verbose === true) {
          logger.debug('Created directory:', dirPath);
        }
      } catch (error) {
        errors.push(
          `Failed to create directory ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { repaired, errors };
  }

  private async repairMissingFiles(
    expandedBaseDir: string,
    missing: string[],
    defaults: DefaultsMap,
    verbose?: boolean,
  ): Promise<{ repaired: string[]; errors: string[] }> {
    const repaired: string[] = [];
    const errors: string[] = [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Missing items iteration requires early continue for missing defaults
    for (const missingItem of missing) {
      if (!defaults[missingItem]) continue;

      const filePath = path.join(expandedBaseDir, missingItem);
      const fileDir = path.dirname(filePath);

      try {
        await fs.mkdir(fileDir, { recursive: true, mode: 0o755 });
      } catch (error) {
        errors.push(
          `Failed to create directory for ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      const tempPath = `${filePath}.tmp.${Date.now()}`;
      try {
        await fs.writeFile(tempPath, defaults[missingItem], { mode: 0o644 });
        await fs.rename(tempPath, filePath);
        repaired.push(missingItem);
        if (verbose === true) {
          logger.debug('Restored file:', filePath);
        }
      } catch (error) {
        errors.push(
          `Failed to restore ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
        );
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    return { repaired, errors };
  }

  /**
   * Repair prompt installation
   * @param baseDir - Base directory to repair
   * @param defaults - Map of default files to restore
   * @param options - Repair options
   * @returns Repair result with fixed issues
   */
  async repair(
    baseDir: string | null,
    defaults: DefaultsMap,
    options?: RepairOptions,
  ): Promise<RepairResult> {
    const validation = await this.validate(baseDir);

    const expandedBaseDir = validation.baseDir;
    const repaired: string[] = [];
    const errors: string[] = [];

    if (!existsSync(expandedBaseDir)) {
      try {
        await fs.mkdir(expandedBaseDir, { recursive: true, mode: 0o755 });
        repaired.push('base directory');
        if (options?.verbose === true) {
          logger.debug('Created base directory:', expandedBaseDir);
        }
      } catch (error) {
        errors.push(
          `Failed to create base directory: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          success: false,
          repaired,
          errors,
          stillInvalid: validation.errors,
        };
      }
    }

    const dirResult = await this.repairMissingDirs(
      expandedBaseDir,
      validation.missing,
      options?.verbose,
    );
    repaired.push(...dirResult.repaired);
    errors.push(...dirResult.errors);

    const fileResult = await this.repairMissingFiles(
      expandedBaseDir,
      validation.missing,
      defaults,
      options?.verbose,
    );
    repaired.push(...fileResult.repaired);
    errors.push(...fileResult.errors);

    let permissionsFixed = false;
    try {
      await fs.chmod(expandedBaseDir, 0o755);
      await this.fixFilePermissions(expandedBaseDir);
      permissionsFixed = true;

      if (options?.verbose === true) {
        logger.debug('Fixed file permissions');
      }
    } catch (error) {
      errors.push(
        `Failed to fix permissions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!validation.isValid && permissionsFixed && errors.length === 0) {
      repaired.push('file permissions');
    }

    const finalValidation = await this.validate(baseDir);

    return {
      success: finalValidation.isValid && errors.length === 0,
      repaired,
      errors,
      stillInvalid: finalValidation.errors,
    };
  }

  private formatBackupTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }

  private classifyBackupError(errorMsg: string): string {
    if (errorMsg.includes('ENOSPC')) {
      return 'Insufficient space: Not enough disk space for backup. Try a different location.';
    }
    if (errorMsg.includes('EACCES') || errorMsg.includes('Permission denied')) {
      return 'Permission denied: Cannot write to backup location. Try a different location or check permissions.';
    }
    return `Backup failed: ${errorMsg}`;
  }

  /**
   * Create backup of current prompts
   * @param baseDir - Base directory to backup
   * @param backupPath - Where to save backup
   * @returns Backup result with location and stats
   */
  async backup(
    baseDir: string | null,
    backupPath: string,
  ): Promise<BackupResult> {
    const expandedBaseDir = baseDir ?? this.expandPath(DEFAULT_BASE_DIR);

    if (!existsSync(expandedBaseDir)) {
      return { success: false, error: 'Nothing to backup' };
    }

    if (!backupPath || backupPath.trim() === '') {
      return { success: false, error: 'Invalid backup path' };
    }

    const timestamp = this.formatBackupTimestamp(new Date());
    const backupDir = path.join(backupPath, `prompt-backup-${timestamp}`);

    try {
      await fs.mkdir(backupDir, { recursive: true });

      let fileCount = 0;
      let totalSize = 0;

      await this.copyDirectory(expandedBaseDir, backupDir, async (filePath) => {
        fileCount++;
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      });

      const manifest = {
        backupDate: new Date().toISOString(),
        sourcePath: expandedBaseDir,
        fileCount,
        totalSize,
      };

      await fs.writeFile(
        path.join(backupDir, 'backup-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );

      const verifyCount = await this.countFiles(backupDir);
      if (verifyCount !== fileCount + 1) {
        logger.warn(
          `Backup verification warning: expected ${fileCount + 1} files, found ${verifyCount}`,
        );
      }

      return { success: true, backupPath: backupDir, fileCount, totalSize };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      try {
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      return { success: false, error: this.classifyBackupError(errorMsg) };
    }
  }

  /**
   * Helper method to copy a directory recursively
   */
  private async copyDirectory(
    source: string,
    dest: string,
    onFile?: (filePath: string) => Promise<void>,
  ): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destPath, onFile);
      } else if (entry.isFile()) {
        await fs.copyFile(sourcePath, destPath);
        await fs.chmod(destPath, 0o644);
        if (onFile) {
          await onFile(sourcePath);
        }
      }
    }
  }

  /**
   * Helper method to count files in a directory
   */
  private async countFiles(dir: string): Promise<number> {
    let count = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await this.countFiles(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        count++;
      }
    }

    return count;
  }

  /**
   * Helper method to fix file permissions recursively
   */
  private async fixFilePermissions(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        try {
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (entry.isDirectory()) {
            await fs.chmod(fullPath, 0o755);
            await this.fixFilePermissions(fullPath);
          } else if (entry.isFile()) {
            await fs.chmod(fullPath, 0o644);
          }
        } catch {
          // Silently continue with other files - some filesystems don't support chmod
        }
      }
    } catch {
      // Silently continue - permissions might not be changeable in some environments
    }
  }

  /**
   * Expand path with home directory and environment variables
   * @param path - Path to expand
   * @returns Expanded absolute path
   */
  expandPath(inputPath: string): string {
    // Handle null or empty input
    if (!inputPath) {
      return '';
    }

    let expandedPath = inputPath;

    // Expand home directory
    if (expandedPath.startsWith('~')) {
      const homeDir = os.homedir();
      expandedPath = expandedPath.replace(/^~/, homeDir);
    }

    // Expand environment variables with curly braces ${VAR}
    expandedPath = expandedPath.replace(
      // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
      /\$\{([^}]+)\}/g,
      (match, varName) => process.env[varName] ?? match,
    );

    // Expand environment variables without curly braces $VAR
    expandedPath = expandedPath.replace(
      /\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (match, varName) => process.env[varName] ?? match,
    );

    // Resolve to absolute path
    if (!path.isAbsolute(expandedPath)) {
      expandedPath = path.resolve(expandedPath);
    }

    // Normalize path (remove redundant separators, resolve . and ..)
    return path.normalize(expandedPath);
  }

  /**
   * Compute SHA-256 hash of content
   * @param content - Content to hash
   * @returns Hex-encoded SHA-256 hash
   */
  hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /**
   * Check if content has NO OVERWRITE flag
   * Hash-based patterns (#, # LLXPRT:) must be at absolute start of file
   * HTML comment pattern (<!-- -->) can be anywhere in file
   */
  private hasNoOverwriteFlag(content: string): boolean {
    const patterns = [
      // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
      /^#\s*NO\s*OVERWRITE/i, // Must be at absolute start of file (no /m flag)
      // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
      /^#\s*LLXPRT:\s*NO\s*OVERWRITE/i, // Must be at absolute start of file (no /m flag)
      // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
      /<!--\s*NO\s*OVERWRITE\s*-->/i, // Can be anywhere in file
    ];
    return patterns.some((p) => p.test(content));
  }

  /**
   * Load installed manifest from disk with Zod validation
   */
  private async loadManifest(
    baseDir: string,
  ): Promise<InstalledManifest | null> {
    const manifestPath = path.join(baseDir, MANIFEST_FILE);
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(content);
      const result = InstalledManifestSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      logger.debug('Invalid manifest format:', result.error.message);
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save manifest to disk
   */
  private async saveManifest(
    baseDir: string,
    manifest: InstalledManifest,
  ): Promise<void> {
    const manifestPath = path.join(baseDir, MANIFEST_FILE);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o644,
    });
  }

  /**
   * Get installed hash for a file from manifest
   */
  private getInstalledHash(
    manifest: InstalledManifest | null,
    relativePath: string,
  ): string | null {
    if (!manifest?.files[relativePath]) {
      return null;
    }
    return manifest.files[relativePath].hash;
  }

  /**
   * Update manifest entry for a file
   */
  private updateManifestEntry(
    manifest: InstalledManifest,
    relativePath: string,
    hash: string,
  ): void {
    manifest.files[relativePath] = {
      hash,
      installedAt: new Date().toISOString(),
    };
  }
}
