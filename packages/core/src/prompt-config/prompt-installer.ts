/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Prompt Installer - Creates directory structure and installs default prompt files while preserving user customizations. */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { DebugLogger } from '../debug/DebugLogger.js';
import {
  type InstalledManifest,
  hashContent as hashContentImpl,
  loadOrCreateManifest,
  saveManifest,
} from './installer/manifest-operations.js';
import { writeInstallFile } from './installer/file-writer.js';
import {
  createDirectoryStructure,
  collectAllFiles,
  setInstalledPermissions,
  removeEmptyDirs,
  fixFilePermissions,
  copyDirectory,
  countFiles,
} from './installer/directory-utils.js';
import {
  type PromptConflictReason,
  type PromptConflictSummary,
  type PromptConflictDetails,
  type ExistingFileDecision,
  handleExistingFile,
  buildRemovalList,
} from './installer/conflict-resolution.js';
import {
  expandPath as expandPathImpl,
  formatBackupTimestamp,
  classifyBackupError,
} from './installer/path-expansion.js';

const logger = new DebugLogger('llxprt:prompt-config:installer');

export const DEFAULT_BASE_DIR = '~/.llxprt/prompts';
export const REQUIRED_DIRECTORIES = ['', 'env', 'tools', 'providers'] as const;

export interface InstallOptions {
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}
export type {
  PromptConflictReason,
  PromptConflictDetails,
  PromptConflictSummary,
  ExistingFileDecision,
};

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
  removeUserFiles?: boolean;
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

export const DefaultsMapSchema = z.record(z.string(), z.string());
export type DefaultsMap = z.infer<typeof DefaultsMapSchema>;

/**
 * PromptInstaller handles installation, validation, and maintenance of prompt files.
 * Delegates cohesive operations to focused helper modules.
 */
export class PromptInstaller {
  private readonly defaultSourceDirs?: readonly string[];

  async install(
    baseDir: string | null,
    defaults: DefaultsMap,
    options?: InstallOptions,
  ): Promise<InstallResult> {
    const expandedBaseDir = baseDir ?? this.expandPath(DEFAULT_BASE_DIR);

    if (expandedBaseDir.includes('..') || !path.isAbsolute(expandedBaseDir)) {
      return this.invalidBaseDirResult(expandedBaseDir);
    }

    const dirErrors = await createDirectoryStructure(
      expandedBaseDir,
      REQUIRED_DIRECTORIES,
      options,
    );
    const manifest = await loadOrCreateManifest(
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
      await setInstalledPermissions(
        expandedBaseDir,
        REQUIRED_DIRECTORIES,
        fileResults.installed,
        options?.verbose,
      );
    }

    await this.persistManifest(
      expandedBaseDir,
      manifest,
      fileResults.installed,
      options,
    );

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

  private invalidBaseDirResult(expandedBaseDir: string): InstallResult {
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

  private async persistManifest(
    expandedBaseDir: string,
    manifest: InstalledManifest | null,
    installed: string[],
    options?: InstallOptions,
  ): Promise<void> {
    if (options?.dryRun !== true && manifest !== null && installed.length > 0) {
      try {
        await saveManifest(expandedBaseDir, manifest);
      } catch (error) {
        if (options?.verbose === true) {
          logger.debug('Could not save manifest:', error);
        }
      }
    }
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

    for (const [relativePath, content] of Object.entries(defaults)) {
      const result = await this.processInstallEntry(
        expandedBaseDir,
        relativePath,
        content,
        manifest,
        options,
      );
      if (result.installed) installed.push(result.path);
      if (result.skipped) skipped.push(result.path);
      if (result.error) errors.push(result.error);
      if (result.conflict) conflicts.push(result.conflict);
      if (result.notice) notices.push(result.notice);
    }

    return { installed, skipped, errors, conflicts, notices };
  }

  private async processInstallEntry(
    expandedBaseDir: string,
    relativePath: string,
    content: string,
    manifest: InstalledManifest | null,
    options?: InstallOptions,
  ): Promise<{
    path: string;
    installed: boolean;
    skipped: boolean;
    error?: string;
    conflict?: PromptConflictSummary;
    notice?: string;
  }> {
    const fullPath = path.join(expandedBaseDir, relativePath);
    const fileDir = path.dirname(fullPath);

    if (!existsSync(fileDir) && options?.dryRun !== true) {
      try {
        await fs.mkdir(fileDir, { recursive: true, mode: 0o755 });
      } catch (error) {
        return {
          path: relativePath,
          installed: false,
          skipped: false,
          error: `Failed to create directory ${fileDir}: ${error instanceof Error ? error.message : String(error)}`,
        };
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
      return {
        path: relativePath,
        installed: false,
        skipped: true,
        conflict: existing.conflict,
        notice: existing.notice,
        error: existing.error,
      };
    }

    const result = await writeInstallFile(
      expandedBaseDir,
      relativePath,
      content,
      manifest,
      options,
    );
    return {
      path: relativePath,
      installed: result.installed,
      skipped: result.skipped,
      error: result.error,
    };
  }

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

    let decision: ExistingFileDecision;
    try {
      decision = await handleExistingFile(
        expandedBaseDir,
        relativePath,
        fullPath,
        content,
        options?.dryRun !== true,
        manifest,
        this.defaultSourceDirs,
      );
    } catch (error) {
      return {
        skip: true,
        error: `Failed to evaluate ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return this.classifyExistingDecision(decision, relativePath, options);
  }

  private classifyExistingDecision(
    decision: ExistingFileDecision,
    relativePath: string,
    options: InstallOptions | undefined,
  ): {
    skip: boolean;
    conflict?: PromptConflictSummary;
    notice?: string;
    error?: string;
  } | null {
    if (decision.action === 'same' || decision.action === 'resolved') {
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
      toRemove = await buildRemovalList(
        expandedBaseDir,
        options?.removeUserFiles === true,
        collectAllFiles,
      );
    } catch (error) {
      errors.push(
        `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const file of toRemove) {
      const result = await this.removeSingleFile(
        file,
        expandedBaseDir,
        options,
      );
      if (result.removed) removed.push(result.path);
      if (result.error) errors.push(result.error);
    }

    if (options?.dryRun !== true) {
      const dirRemovals = await removeEmptyDirs(
        expandedBaseDir,
        REQUIRED_DIRECTORIES,
      );
      removed.push(...dirRemovals);
    }

    return { success: errors.length === 0, removed, errors };
  }

  private async removeSingleFile(
    file: string,
    expandedBaseDir: string,
    options?: UninstallOptions,
  ): Promise<{ path: string; removed: boolean; error?: string }> {
    const fullPath = path.join(expandedBaseDir, file);

    if (options?.dryRun === true) {
      logger.debug('Would remove:', fullPath);
      return { path: file, removed: true };
    }

    try {
      await fs.unlink(fullPath);
      return { path: file, removed: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        path: file,
        removed: false,
        error: this.classifyRemovalError(file, errorMsg),
      };
    }
  }

  private classifyRemovalError(
    file: string,
    errorMsg: string,
  ): string | undefined {
    if (errorMsg.includes('EBUSY')) {
      return `File in use: ${file}. Close any programs using this file and try again.`;
    }
    if (errorMsg.includes('EACCES') || errorMsg.includes('Permission denied')) {
      return `Permission denied: ${file}`;
    }
    if (!errorMsg.includes('ENOENT')) {
      return `Failed to remove ${file}: ${errorMsg}`;
    }
    return undefined;
  }

  async validate(baseDir: string | null): Promise<ValidationResult> {
    const expandedBaseDir = baseDir ?? this.expandPath(DEFAULT_BASE_DIR);

    let isValid = true;
    const errors: string[] = [];
    const warnings: string[] = [];
    const missing: string[] = [];

    if (!existsSync(expandedBaseDir)) {
      errors.push('Base directory does not exist');
      return {
        isValid: false,
        errors,
        warnings,
        missing,
        baseDir: expandedBaseDir,
      };
    }

    this.validateDirectoryStructure(expandedBaseDir, errors, warnings, missing);
    if (errors.length > 0) isValid = false;

    await this.validatePermissions(expandedBaseDir, errors, warnings);
    if (errors.some((e) => e.includes('Cannot read'))) isValid = false;

    isValid = await this.validateCoreIntegrity(
      expandedBaseDir,
      errors,
      warnings,
      isValid,
    );

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

  private async validateCoreIntegrity(
    expandedBaseDir: string,
    errors: string[],
    warnings: string[],
    currentValid: boolean,
  ): Promise<boolean> {
    let isValid = currentValid;
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
    return isValid;
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
      const result = await this.repairCreateBase(expandedBaseDir, options);
      repaired.push(...result.repaired);
      errors.push(...result.errors);
      if (result.failed) {
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

    const permsResult = await this.repairPermissions(expandedBaseDir, options);
    if (
      !validation.isValid &&
      permsResult.fixed &&
      permsResult.errors.length === 0
    ) {
      repaired.push('file permissions');
    }
    errors.push(...permsResult.errors);

    const finalValidation = await this.validate(baseDir);

    return {
      success: finalValidation.isValid && errors.length === 0,
      repaired,
      errors,
      stillInvalid: finalValidation.errors,
    };
  }

  private async repairCreateBase(
    expandedBaseDir: string,
    options?: RepairOptions,
  ): Promise<{ repaired: string[]; errors: string[]; failed: boolean }> {
    try {
      await fs.mkdir(expandedBaseDir, { recursive: true, mode: 0o755 });
      if (options?.verbose === true) {
        logger.debug('Created base directory:', expandedBaseDir);
      }
      return { repaired: ['base directory'], errors: [], failed: false };
    } catch (error) {
      return {
        repaired: [],
        errors: [
          `Failed to create base directory: ${error instanceof Error ? error.message : String(error)}`,
        ],
        failed: true,
      };
    }
  }

  private async repairPermissions(
    expandedBaseDir: string,
    options?: RepairOptions,
  ): Promise<{ fixed: boolean; errors: string[] }> {
    try {
      await fs.chmod(expandedBaseDir, 0o755);
      await fixFilePermissions(expandedBaseDir);

      if (options?.verbose === true) {
        logger.debug('Fixed file permissions');
      }
      return { fixed: true, errors: [] };
    } catch (error) {
      return {
        fixed: false,
        errors: [
          `Failed to fix permissions: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
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

    for (const missingItem of missing) {
      const result = await this.repairSingleFile(
        expandedBaseDir,
        missingItem,
        defaults,
        verbose,
      );
      if (result.repaired) repaired.push(missingItem);
      if (result.error) errors.push(result.error);
    }

    return { repaired, errors };
  }

  private async repairSingleFile(
    expandedBaseDir: string,
    missingItem: string,
    defaults: DefaultsMap,
    verbose?: boolean,
  ): Promise<{ repaired: boolean; error?: string }> {
    if (!defaults[missingItem]) {
      return { repaired: false };
    }

    const filePath = path.join(expandedBaseDir, missingItem);
    const fileDir = path.dirname(filePath);

    try {
      await fs.mkdir(fileDir, { recursive: true, mode: 0o755 });
    } catch (error) {
      return {
        repaired: false,
        error: `Failed to create directory for ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const tempPath = `${filePath}.tmp.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, defaults[missingItem], { mode: 0o644 });
      await fs.rename(tempPath, filePath);
      if (verbose === true) {
        logger.debug('Restored file:', filePath);
      }
      return { repaired: true };
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      return {
        repaired: false,
        error: `Failed to restore ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

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

    const timestamp = formatBackupTimestamp(new Date());
    const backupDir = path.join(backupPath, `prompt-backup-${timestamp}`);

    try {
      return await this.performBackup(expandedBaseDir, backupDir);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      return { success: false, error: classifyBackupError(errorMsg) };
    }
  }

  private async performBackup(
    expandedBaseDir: string,
    backupDir: string,
  ): Promise<BackupResult> {
    await fs.mkdir(backupDir, { recursive: true });

    let fileCount = 0;
    let totalSize = 0;

    await copyDirectory(expandedBaseDir, backupDir, async (filePath) => {
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

    const verifyCount = await countFiles(backupDir);
    if (verifyCount !== fileCount + 1) {
      logger.warn(
        `Backup verification warning: expected ${fileCount + 1} files, found ${verifyCount}`,
      );
    }

    return { success: true, backupPath: backupDir, fileCount, totalSize };
  }

  expandPath(inputPath: string): string {
    return expandPathImpl(inputPath);
  }

  hashContent(content: string): string {
    return hashContentImpl(content);
  }
}
