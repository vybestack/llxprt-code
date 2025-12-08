/**
 * Prompt Installer - Creates directory structure and installs default prompt files
 * while preserving user customizations.
 *
 * This is a TDD stub implementation. All methods throw "Not implemented" errors.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import type { Stats } from 'fs';
import { createHash } from 'node:crypto';

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

// Manifest types
interface InstalledFileEntry {
  hash: string;
  installedAt: string;
}

interface InstalledManifest {
  version: number;
  files: Record<string, InstalledFileEntry>;
}

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

  /**
   * Install default prompt files
   * @param baseDir - Base directory for prompts (defaults to DEFAULT_BASE_DIR)
   * @param defaults - Map of relative path to file content
   * @param options - Installation options
   * @returns Installation result with success status and details
   */
  async install(
    baseDir: string | null,
    defaults: DefaultsMap,
    options?: InstallOptions,
  ): Promise<InstallResult> {
    const installed: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];
    const conflicts: PromptConflictSummary[] = [];
    const notices: string[] = [];

    // Prepare installation
    let expandedBaseDir = baseDir;
    if (!expandedBaseDir) {
      expandedBaseDir = this.expandPath(DEFAULT_BASE_DIR);
    }

    // Validate baseDir
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

    // Create directory structure
    for (const dir of REQUIRED_DIRECTORIES) {
      const fullPath = path.join(expandedBaseDir, dir);

      if (options?.dryRun) {
        if (options?.verbose) {
          console.log('Would create:', fullPath);
        }
      } else {
        try {
          await fs.mkdir(fullPath, { recursive: true, mode: 0o755 });
          if (options?.verbose) {
            console.log('Created directory:', fullPath);
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          if (
            errorMsg.includes('EACCES') ||
            errorMsg.includes('permission denied')
          ) {
            errors.push(`Permission denied: ${fullPath}`);
          } else {
            errors.push(`Failed to create directory ${fullPath}: ${errorMsg}`);
          }
        }
      }
    }

    // Load manifest for hash-based modification tracking
    let manifest: InstalledManifest | null = null;
    if (!options?.dryRun && existsSync(expandedBaseDir)) {
      manifest = await this.loadManifest(expandedBaseDir);
    }
    // Initialize manifest if it doesn't exist
    if (!manifest && !options?.dryRun) {
      manifest = { version: MANIFEST_VERSION, files: {} };
    }

    // Install default files
    for (const [relativePath, content] of Object.entries(defaults)) {
      const fullPath = path.join(expandedBaseDir, relativePath);
      const fileDir = path.dirname(fullPath);

      // Create parent directory if needed
      if (!existsSync(fileDir) && !options?.dryRun) {
        try {
          await fs.mkdir(fileDir, { recursive: true, mode: 0o755 });
        } catch (error) {
          errors.push(
            `Failed to create directory ${fileDir}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
      }

      // Track if we should write file (for overwrite action)
      let shouldWriteFile = false;

      // Check existing file
      if (existsSync(fullPath) && !options?.force) {
        const decision = await this.handleExistingFile(
          expandedBaseDir,
          relativePath,
          fullPath,
          content,
          !options?.dryRun,
          manifest,
        ).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push(`Failed to evaluate ${relativePath}: ${message}`);
          return { action: 'same' } as ExistingFileDecision;
        });

        if (decision.action === 'same') {
          skipped.push(relativePath);
          if (options?.verbose) {
            console.log('Preserving existing:', relativePath);
          }
          continue;
        }

        if (decision.action === 'resolved') {
          skipped.push(relativePath);
          if (options?.verbose) {
            console.log(
              'Default update already provided for review:',
              relativePath,
            );
          }
          continue;
        }

        if (decision.action === 'keep') {
          conflicts.push(decision.conflict);
          if (decision.notice) {
            notices.push(decision.notice);
          }
          skipped.push(relativePath);
          continue;
        }

        if (decision.action === 'overwrite') {
          // User never modified - safe to silently overwrite
          shouldWriteFile = true;
          if (options?.verbose) {
            console.log('Updating unmodified file:', relativePath);
          }
        }
      } else {
        // File doesn't exist or force mode - write it
        shouldWriteFile = true;
      }

      // Write file only if shouldWriteFile is true
      if (!shouldWriteFile) {
        continue;
      }

      if (options?.dryRun) {
        if (options?.verbose) {
          console.log('Would write:', fullPath);
        }
        installed.push(relativePath);
      } else {
        const tempPath = `${fullPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`;
        try {
          // Write to temp file first (atomic write)
          await fs.writeFile(tempPath, content, { mode: 0o644 });
          // Rename temp to final - this is atomic and will fail if file exists
          try {
            await fs.rename(tempPath, fullPath);
            installed.push(relativePath);
            // Update manifest with new hash
            if (manifest) {
              this.updateManifestEntry(
                manifest,
                relativePath,
                this.hashContent(content),
              );
            }
            if (options?.verbose) {
              console.log('Installed:', relativePath);
            }
          } catch (renameError) {
            // If rename failed because file already exists, it's OK (race condition)
            const renameMsg =
              renameError instanceof Error
                ? renameError.message
                : String(renameError);
            if (renameMsg.includes('EEXIST') || existsSync(fullPath)) {
              skipped.push(relativePath);
              // Clean up temp file
              await fs.unlink(tempPath);
            } else {
              throw renameError;
            }
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          if (
            errorMsg.includes('EACCES') ||
            errorMsg.includes('Permission denied')
          ) {
            errors.push(
              `Permission denied: ${fullPath}. Try running with elevated permissions or changing the directory ownership.`,
            );
          } else if (errorMsg.includes('ENOSPC')) {
            errors.push(
              `Disk full: Cannot write ${fullPath}. Free up some disk space and try again.`,
            );
          } else {
            errors.push(`Failed to write ${fullPath}: ${errorMsg}`);
          }
          // Clean up temp file if it exists
          try {
            await fs.unlink(tempPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }

    // Set permissions on all files (if not dry run)
    if (!options?.dryRun && errors.length === 0) {
      try {
        // Set base directory permissions
        await fs.chmod(expandedBaseDir, 0o755);

        // Set permissions on all subdirectories
        for (const dir of REQUIRED_DIRECTORIES) {
          if (dir !== '') {
            const dirPath = path.join(expandedBaseDir, dir);
            if (existsSync(dirPath)) {
              await fs.chmod(dirPath, 0o755);
            }
          }
        }

        // Set permissions on all installed files
        for (const file of installed) {
          const filePath = path.join(expandedBaseDir, file);
          if (existsSync(filePath)) {
            await fs.chmod(filePath, 0o644);
          }
        }
      } catch (error) {
        // Non-critical error, don't fail the installation
        if (options?.verbose) {
          console.log('Could not set permissions:', error);
        }
      }
    }

    // Save manifest (if not dry run and we have a manifest)
    if (!options?.dryRun && manifest && installed.length > 0) {
      try {
        await this.saveManifest(expandedBaseDir, manifest);
      } catch (error) {
        // Non-critical error, don't fail the installation
        if (options?.verbose) {
          console.log('Could not save manifest:', error);
        }
      }
    }

    return {
      success: errors.length === 0,
      installed,
      skipped,
      errors,
      baseDir: expandedBaseDir,
      conflicts,
      notices,
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

    // Validate inputs
    let expandedBaseDir = baseDir;
    if (!expandedBaseDir) {
      expandedBaseDir = this.expandPath(DEFAULT_BASE_DIR);
    }

    // If base directory doesn't exist, return success with empty arrays
    if (!existsSync(expandedBaseDir)) {
      return {
        success: true,
        removed: [],
        errors: [],
      };
    }

    // Build removal list
    const toRemove: string[] = [];

    if (options?.removeUserFiles) {
      // Remove all files
      try {
        await this.collectAllFiles(expandedBaseDir, expandedBaseDir, toRemove);
      } catch (error) {
        errors.push(
          `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      // Remove only default files (core.md and files in standard directories)
      const defaultPaths = [
        'core.md',
        'env/development.md',
        'env/dev.md',
        'tools/git.md',
        'providers/openai.md',
      ];

      for (const filePath of defaultPaths) {
        const fullPath = path.join(expandedBaseDir, filePath);
        if (existsSync(fullPath)) {
          toRemove.push(filePath);
        }
      }
    }

    // Remove files
    for (const file of toRemove) {
      const fullPath = path.join(expandedBaseDir, file);

      if (options?.dryRun) {
        console.log('Would remove:', fullPath);
        removed.push(file);
      } else {
        try {
          await fs.unlink(fullPath);
          removed.push(file);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
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
            // Ignore "file not found" errors
            errors.push(`Failed to remove ${file}: ${errorMsg}`);
          }
        }
      }
    }

    // Remove empty directories (in reverse order to remove children first)
    if (!options?.dryRun) {
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
    }

    return {
      success: errors.length === 0,
      removed,
      errors,
    };
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

  /**
   * Validate prompt installation
   * @param baseDir - Base directory to validate
   * @returns Validation result with issues found
   */
  async validate(baseDir: string | null): Promise<ValidationResult> {
    // Setup validation
    let expandedBaseDir = baseDir;
    if (!expandedBaseDir) {
      expandedBaseDir = this.expandPath(DEFAULT_BASE_DIR);
    }

    let isValid = true;
    const errors: string[] = [];
    const warnings: string[] = [];
    const missing: string[] = [];

    // Check base directory
    if (!existsSync(expandedBaseDir)) {
      errors.push('Base directory does not exist');
      isValid = false;
      return {
        isValid,
        errors,
        warnings,
        missing,
        baseDir: expandedBaseDir,
      };
    }

    // Check directory structure
    for (const dir of REQUIRED_DIRECTORIES) {
      if (dir === '') continue; // Skip base directory itself

      const fullPath = path.join(expandedBaseDir, dir);
      if (!existsSync(fullPath)) {
        missing.push(dir);
        warnings.push(`Missing directory: ${dir}`);
      }
    }

    // Check required files
    const corePath = path.join(expandedBaseDir, 'core.md');
    if (!existsSync(corePath)) {
      missing.push('core.md');
      errors.push('Missing required core.md');
      isValid = false;
    }

    // Check permissions
    try {
      // Check read permission
      await fs.access(expandedBaseDir, fs.constants.R_OK);
    } catch {
      errors.push('Cannot read from directory');
      isValid = false;
    }

    try {
      // Check write permission
      await fs.access(expandedBaseDir, fs.constants.W_OK);
    } catch {
      warnings.push('Cannot write to directory');
    }

    // Check file integrity
    if (existsSync(corePath)) {
      try {
        const stats = await fs.stat(corePath);
        if (stats.size === 0) {
          warnings.push('Empty file: core.md');
        }

        // Check if file is readable
        try {
          await fs.access(corePath, fs.constants.R_OK);
        } catch {
          errors.push('Cannot read: core.md');
        }
      } catch (error) {
        errors.push(
          `Error checking core.md: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Check other default files if they exist
    const defaultFiles = [
      'env/development.md',
      'tools/git.md',
      'providers/openai.md',
    ];

    for (const file of defaultFiles) {
      const filePath = path.join(expandedBaseDir, file);
      if (existsSync(filePath)) {
        try {
          const stats = await fs.stat(filePath);
          if (stats.size === 0) {
            warnings.push(`Empty file: ${file}`);
          }

          // Check if file is readable
          try {
            await fs.access(filePath, fs.constants.R_OK);
          } catch {
            errors.push(`Cannot read: ${file}`);
          }
        } catch {
          // Ignore errors for optional files
        }
      }
    }

    return {
      isValid,
      errors,
      warnings,
      missing,
      baseDir: expandedBaseDir,
    };
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
    // Run validation first
    const validation = await this.validate(baseDir);

    const expandedBaseDir = validation.baseDir;
    const repaired: string[] = [];
    const errors: string[] = [];

    // Create base directory if it doesn't exist
    if (!existsSync(expandedBaseDir)) {
      try {
        await fs.mkdir(expandedBaseDir, { recursive: true, mode: 0o755 });
        repaired.push('base directory');
        if (options?.verbose) {
          console.log('Created base directory:', expandedBaseDir);
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

    // Fix missing directories
    for (const missingItem of validation.missing) {
      // Check if it's a directory (from REQUIRED_DIRECTORIES)
      if (
        REQUIRED_DIRECTORIES.includes(
          missingItem as (typeof REQUIRED_DIRECTORIES)[number],
        )
      ) {
        const dirPath = path.join(expandedBaseDir, missingItem);
        try {
          await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
          repaired.push(missingItem);
          if (options?.verbose) {
            console.log('Created directory:', dirPath);
          }
        } catch (error) {
          errors.push(
            `Failed to create directory ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    // Fix missing default files
    for (const missingItem of validation.missing) {
      // Check if it's a file (has content in defaults)
      if (defaults[missingItem]) {
        const filePath = path.join(expandedBaseDir, missingItem);
        const fileDir = path.dirname(filePath);

        // Ensure parent directory exists
        try {
          await fs.mkdir(fileDir, { recursive: true, mode: 0o755 });
        } catch (error) {
          errors.push(
            `Failed to create directory for ${missingItem}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        // Write the file
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        try {
          await fs.writeFile(tempPath, defaults[missingItem], { mode: 0o644 });
          await fs.rename(tempPath, filePath);
          repaired.push(missingItem);
          if (options?.verbose) {
            console.log('Restored file:', filePath);
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
    }

    // Always fix permissions (even if validation passed)
    let permissionsFixed = false;
    try {
      // Fix directory permissions
      await fs.chmod(expandedBaseDir, 0o755);

      // Fix all file and directory permissions recursively
      await this.fixFilePermissions(expandedBaseDir);
      permissionsFixed = true;

      if (options?.verbose) {
        console.log('Fixed file permissions');
      }
    } catch (error) {
      errors.push(
        `Failed to fix permissions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // If we started with a valid installation, don't report permissions as repaired
    // Only report actual repairs that fixed validation issues
    if (!validation.isValid && permissionsFixed && errors.length === 0) {
      repaired.push('file permissions');
    }

    // Run validation again
    const finalValidation = await this.validate(baseDir);

    return {
      success: finalValidation.isValid && errors.length === 0,
      repaired,
      errors,
      stillInvalid: finalValidation.errors,
    };
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
    // Validate inputs
    let expandedBaseDir = baseDir;
    if (!expandedBaseDir) {
      expandedBaseDir = this.expandPath(DEFAULT_BASE_DIR);
    }

    if (!existsSync(expandedBaseDir)) {
      return {
        success: false,
        error: 'Nothing to backup',
      };
    }

    if (!backupPath || backupPath.trim() === '') {
      return {
        success: false,
        error: 'Invalid backup path',
      };
    }

    // Create backup
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
    const backupDir = path.join(backupPath, `prompt-backup-${timestamp}`);

    try {
      // Create backup directory
      await fs.mkdir(backupDir, { recursive: true });

      // Copy files
      let fileCount = 0;
      let totalSize = 0;

      await this.copyDirectory(expandedBaseDir, backupDir, async (filePath) => {
        fileCount++;
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      });

      // Create manifest
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

      // Verify backup
      const verifyCount = await this.countFiles(backupDir);
      if (verifyCount !== fileCount + 1) {
        // +1 for manifest
        console.warn(
          `Backup verification warning: expected ${fileCount + 1} files, found ${verifyCount}`,
        );
      }

      return {
        success: true,
        backupPath: backupDir,
        fileCount,
        totalSize,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Clean up partial backup on error
      try {
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      if (errorMsg.includes('ENOSPC')) {
        return {
          success: false,
          error:
            'Insufficient space: Not enough disk space for backup. Try a different location.',
        };
      } else if (
        errorMsg.includes('EACCES') ||
        errorMsg.includes('Permission denied')
      ) {
        return {
          success: false,
          error: `Permission denied: Cannot write to backup location. Try a different location or check permissions.`,
        };
      }

      return {
        success: false,
        error: `Backup failed: ${errorMsg}`,
      };
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
      /\$\{([^}]+)\}/g,
      (match, varName) => process.env[varName] || match,
    );

    // Expand environment variables without curly braces $VAR
    expandedPath = expandedPath.replace(
      /\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (match, varName) => process.env[varName] || match,
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
   */
  private hasNoOverwriteFlag(content: string): boolean {
    const patterns = [
      /^#\s*NO\s*OVERWRITE/im,
      /^#\s*LLXPRT:\s*NO\s*OVERWRITE/im,
      /<!--\s*NO\s*OVERWRITE\s*-->/i,
    ];
    return patterns.some((p) => p.test(content));
  }

  /**
   * Load installed manifest from disk
   */
  private async loadManifest(
    baseDir: string,
  ): Promise<InstalledManifest | null> {
    const manifestPath = path.join(baseDir, MANIFEST_FILE);
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as InstalledManifest;
      if (manifest.version && manifest.files) {
        return manifest;
      }
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
    if (!manifest || !manifest.files[relativePath]) {
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
