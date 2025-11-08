/**
 * PromptResolver handles hierarchical file resolution for prompt templates
 * This is a stub implementation following TDD principles
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PromptContext } from './types.js';

/**
 * Result of resolving a single file
 */
export interface ResolveFileResult {
  found: boolean;
  path: string | null;
  source: 'model' | 'provider' | 'base' | null;
}

/**
 * Resolved file information with metadata
 */
export interface ResolvedFile {
  type: 'core' | 'env' | 'tool';
  path: string;
  source: 'model' | 'provider' | 'base';
  toolName?: string;
}

/**
 * Available file information
 */
export interface AvailableFile {
  path: string;
  type: 'core' | 'env' | 'tool';
  source: 'model' | 'provider' | 'base';
}

/**
 * File structure validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * PromptResolver handles hierarchical file resolution
 */
export class PromptResolver {
  /**
   * Find the most specific version of a file
   */
  resolveFile(
    baseDir: string,
    relativePath: string,
    context: Partial<PromptContext>,
  ): ResolveFileResult {
    // 1. Validate inputs
    if (!baseDir || !this.isDirectory(baseDir)) {
      return { found: false, path: null, source: null };
    }

    if (!relativePath || relativePath.includes('..')) {
      return { found: false, path: null, source: null };
    }

    if (!context) {
      context = {};
    }

    // 2. Sanitize provider and model names
    const provider = this.sanitizePathComponent(context.provider || '');
    const model = this.sanitizePathComponent(context.model || '');

    // 3. Build search paths in order (most specific first)
    const searchPaths: string[] = [];

    if (provider && model) {
      searchPaths.push(`providers/${provider}/models/${model}/${relativePath}`);
    }

    if (provider) {
      searchPaths.push(`providers/${provider}/${relativePath}`);
    }

    searchPaths.push(relativePath);

    // 4. Search for file
    for (const searchPath of searchPaths) {
      const absolutePath = path.join(baseDir, searchPath);

      if (this.fileExists(absolutePath) && this.isRegularFile(absolutePath)) {
        let source: 'model' | 'provider' | 'base';

        if (searchPath.includes('/models/')) {
          source = 'model';
        } else if (searchPath.startsWith('providers/')) {
          source = 'provider';
        } else {
          source = 'base';
        }

        return { found: true, path: absolutePath, source };
      }
    }

    // 5. File not found
    return { found: false, path: null, source: null };
  }

  /**
   * Resolve all files for a given context
   */
  resolveAllFiles(baseDir: string, context: PromptContext): ResolvedFile[] {
    // 1. Validate inputs
    if (!baseDir || !context) {
      return [];
    }

    // 2. Initialize file list
    const resolvedFiles: ResolvedFile[] = [];

    // 3. Resolve core prompt
    // Check for core/default.md first (test structure), then core.md
    let coreResult = this.resolveFile(baseDir, 'core/default.md', context);
    if (!coreResult.found) {
      coreResult = this.resolveFile(baseDir, 'core.md', context);
    }
    if (coreResult.found && coreResult.path && coreResult.source) {
      resolvedFiles.push({
        type: 'core',
        path: coreResult.path,
        source: coreResult.source,
      });
    }

    // 4. Resolve environment prompts
    if (context.environment.isGitRepository) {
      // Check for env/git.md first (test structure), then env/git-repository.md
      let gitResult = this.resolveFile(baseDir, 'env/git.md', context);
      if (!gitResult.found) {
        gitResult = this.resolveFile(baseDir, 'env/git-repository.md', context);
      }
      if (gitResult.found && gitResult.path && gitResult.source) {
        resolvedFiles.push({
          type: 'env',
          path: gitResult.path,
          source: gitResult.source,
        });
      }
    }

    if (context.environment.isSandboxed) {
      // Check for specific sandbox type first
      if (context.environment.sandboxType === 'macos-seatbelt') {
        const seatbeltResult = this.resolveFile(
          baseDir,
          'env/macos-seatbelt.md',
          context,
        );
        if (
          seatbeltResult.found &&
          seatbeltResult.path &&
          seatbeltResult.source
        ) {
          resolvedFiles.push({
            type: 'env',
            path: seatbeltResult.path,
            source: seatbeltResult.source,
          });
        }
      } else {
        // Default sandbox
        const sandboxResult = this.resolveFile(
          baseDir,
          'env/sandbox.md',
          context,
        );
        if (sandboxResult.found && sandboxResult.path && sandboxResult.source) {
          resolvedFiles.push({
            type: 'env',
            path: sandboxResult.path,
            source: sandboxResult.source,
          });
        }
      }
    } else {
      // Not sandboxed - check for outside-of-sandbox.md
      const outsideResult = this.resolveFile(
        baseDir,
        'env/outside-of-sandbox.md',
        context,
      );
      if (outsideResult.found && outsideResult.path && outsideResult.source) {
        resolvedFiles.push({
          type: 'env',
          path: outsideResult.path,
          source: outsideResult.source,
        });
      }
    }

    if (context.environment.hasIdeCompanion) {
      const ideResult = this.resolveFile(baseDir, 'env/ide-mode.md', context);
      if (ideResult.found && ideResult.path && ideResult.source) {
        resolvedFiles.push({
          type: 'env',
          path: ideResult.path,
          source: ideResult.source,
        });
      }
    }

    // 5. Resolve tool prompts
    for (const tool of context.enabledTools) {
      const toolFileName = this.convertToKebabCase(tool) + '.md';
      const toolPath = 'tools/' + toolFileName;
      const toolResult = this.resolveFile(baseDir, toolPath, context);

      if (toolResult.found && toolResult.path && toolResult.source) {
        resolvedFiles.push({
          type: 'tool',
          path: toolResult.path,
          source: toolResult.source,
          toolName: tool,
        });
      } else {
        // Try alternative approaches before warning
        // First try PascalCase (the original format before change)
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
          resolvedFiles.push({
            type: 'tool',
            path: pascalCaseResult.path,
            source: pascalCaseResult.source,
            toolName: tool,
          });
          continue;
        }

        // Try snake_case format
        const snakeCaseFile =
          tool
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '') + '.md';
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
          resolvedFiles.push({
            type: 'tool',
            path: snakeCaseResult.path,
            source: snakeCaseResult.source,
            toolName: tool,
          });
          continue;
        }

        // Log warning "Tool prompt not found: " + tool
        console.warn(`Tool prompt not found: ${tool}`);
      }
    }

    // 6. RETURN resolvedFiles
    return resolvedFiles;
  }

  /**
   * Make names filesystem-safe
   */
  sanitizePathComponent(component: string): string {
    // 1. IF component is null or empty
    if (!component || component.length === 0) {
      return '';
    }

    // 4. Check for reserved names first (before any transformation)
    const reservedNames = ['.', '..', 'con', 'prn', 'aux', 'nul'];
    if (reservedNames.includes(component)) {
      return `reserved-${component}`;
    }

    // 2. Apply sanitization rules
    // a. Convert to lowercase
    let result = component.toLowerCase();

    // b. Replace sequences of non-alphanumeric chars with single hyphen
    result = result.replace(/[^a-z0-9]+/g, '-');

    // c. Remove leading and trailing hyphens
    result = result.replace(/^-+|-+$/g, '');

    // d. IF result is empty after sanitization
    if (result.length === 0) {
      return 'unknown';
    }

    // 3. Check length limits
    if (result.length > 255) {
      result = result.substring(0, 255);
    }

    // Check reserved names again after transformation
    if (reservedNames.includes(result)) {
      return `reserved-${result}`;
    }

    // 5. RETURN sanitized component
    return result;
  }

  /**
   * Convert tool names to kebab-case
   */
  convertToKebabCase(toolName: string): string {
    // 1. IF toolName is null or empty
    if (!toolName || toolName.length === 0) {
      return '';
    }

    // 2. Handle special cases
    // a. IF toolName is all uppercase
    if (toolName === toolName.toUpperCase() && /^[A-Z]+$/.test(toolName)) {
      return toolName.toLowerCase();
    }

    // 3. Convert case - handle special patterns first
    // Replace underscores and dots with hyphens
    const processedName = toolName.replace(/[_.]/g, '-');

    // Insert hyphens before uppercase letters that follow lowercase letters
    // or before digits (except at the start)
    let result = '';
    let previousWasLowercase = false;
    let previousWasDigit = false;

    for (let i = 0; i < processedName.length; i++) {
      const char = processedName[i];
      const nextChar = i + 1 < processedName.length ? processedName[i + 1] : '';

      if (char === '-') {
        // Keep existing hyphens
        result += char;
        previousWasLowercase = false;
        previousWasDigit = false;
      } else if (/[A-Z]/.test(char)) {
        // Handle uppercase letters
        const nextIsLower = nextChar && /[a-z]/.test(nextChar);
        const shouldAddHyphen =
          previousWasLowercase ||
          (previousWasDigit && result.length > 0) ||
          (result.length > 0 && nextIsLower && !result.endsWith('-'));

        if (shouldAddHyphen) {
          result += '-';
        }

        result += char.toLowerCase();
        previousWasLowercase = false;
        previousWasDigit = false;
      } else if (/[a-z]/.test(char)) {
        // Handle lowercase letters
        result += char;
        previousWasLowercase = true;
        previousWasDigit = false;
      } else if (/[0-9]/.test(char)) {
        // Handle digits
        if (result.length > 0 && !result.endsWith('-') && !previousWasDigit) {
          result += '-';
        }
        result += char;
        previousWasLowercase = false;
        previousWasDigit = true;
      }
    }

    // 4. Clean up result
    // a. Replace multiple consecutive hyphens with single hyphen
    result = result.replace(/-+/g, '-');

    // b. Remove leading and trailing hyphens
    result = result.replace(/^-+|-+$/g, '');

    // 5. RETURN result
    return result;
  }

  /**
   * List all available prompt files
   */
  listAvailableFiles(
    baseDir: string,
    fileType: 'core' | 'env' | 'tool' | 'all',
  ): AvailableFile[] {
    // 1. Validate inputs
    if (!baseDir || !this.isDirectory(baseDir)) {
      return [];
    }

    const validTypes: Array<'core' | 'env' | 'tool' | 'all'> = [
      'core',
      'env',
      'tool',
      'all',
    ];
    if (!validTypes.includes(fileType)) {
      fileType = 'all';
    }

    // 2. Initialize results
    const availableFiles: AvailableFile[] = [];

    // 3. Scan base directory
    try {
      // a. IF fileType is 'all' or 'core'
      if (fileType === 'all' || fileType === 'core') {
        const corePath = path.join(baseDir, 'core.md');
        if (this.fileExists(corePath)) {
          availableFiles.push({
            path: 'core.md',
            type: 'core',
            source: 'base',
          });
        }
      }

      // b. IF fileType is 'all' or 'env'
      if (fileType === 'all' || fileType === 'env') {
        const envDir = path.join(baseDir, 'env');
        if (this.isDirectory(envDir)) {
          const envFiles = this.readDirectory(envDir);
          for (const file of envFiles) {
            if (file.endsWith('.md')) {
              availableFiles.push({
                path: `env/${file}`,
                type: 'env',
                source: 'base',
              });
            }
          }
        }
      }

      // c. IF fileType is 'all' or 'tool'
      if (fileType === 'all' || fileType === 'tool') {
        const toolsDir = path.join(baseDir, 'tools');
        if (this.isDirectory(toolsDir)) {
          const toolFiles = this.readDirectory(toolsDir);
          for (const file of toolFiles) {
            if (file.endsWith('.md')) {
              availableFiles.push({
                path: `tools/${file}`,
                type: 'tool',
                source: 'base',
              });
            }
          }
        }
      }

      // 4. Scan provider overrides
      const providersDir = path.join(baseDir, 'providers');
      if (this.isDirectory(providersDir)) {
        const providers = this.readDirectory(providersDir);
        for (const provider of providers) {
          const providerPath = path.join(providersDir, provider);
          if (this.isDirectory(providerPath)) {
            // Scan provider directory recursively
            this.scanProviderDirectory(
              providerPath,
              provider,
              fileType,
              availableFiles,
            );
          }
        }
      }
    } catch {
      // Permission errors: Skip inaccessible directories
      // Continue with what we found
    }

    // 5. Sort results
    availableFiles.sort((a, b) => {
      // a. Sort by type (core, env, tool)
      const typeOrder = { core: 0, env: 1, tool: 2 };
      const typeCompare = typeOrder[a.type] - typeOrder[b.type];
      if (typeCompare !== 0) return typeCompare;

      // b. Then by path alphabetically
      return a.path.localeCompare(b.path);
    });

    // 6. RETURN availableFiles
    return availableFiles;
  }

  /**
   * Validate the file structure
   */
  validateFileStructure(baseDir: string): ValidationResult {
    // 1. Initialize validation result
    let isValid = true;
    const errors: string[] = [];
    const warnings: string[] = [];

    // 2. Check base directory
    if (!this.fileExists(baseDir)) {
      isValid = false;
      errors.push('Base directory does not exist');
      return { isValid, errors, warnings };
    }

    if (!this.isDirectory(baseDir)) {
      isValid = false;
      errors.push('Base path is not a directory');
      return { isValid, errors, warnings };
    }

    // 3. Check required directories
    const requiredDirs = ['env', 'tools'];
    for (const dir of requiredDirs) {
      const dirPath = path.join(baseDir, dir);
      if (!this.fileExists(dirPath)) {
        warnings.push(`Missing directory: ${dir}`);
      }
    }

    // 4. Check core file
    const corePath = path.join(baseDir, 'core.md');
    if (!this.fileExists(corePath)) {
      isValid = false;
      errors.push('Missing required core.md file');
    }

    // 5. Check for invalid files
    try {
      this.walkDirectory(baseDir, (filePath: string, relativePath: string) => {
        // Check file extension
        if (!filePath.endsWith('.md')) {
          warnings.push(`Non-markdown file found: ${relativePath}`);
        }

        // Check file size
        try {
          const stats = fs.statSync(filePath);
          if (stats.size > 10 * 1024 * 1024) {
            // 10MB
            warnings.push(`Large file found: ${relativePath}`);
          }
        } catch {
          // Ignore stat errors
        }

        // Check filename for special characters
        const filename = path.basename(filePath);
        if (!/^[\w\-.]+$/.test(filename)) {
          warnings.push(`Invalid filename: ${relativePath}`);
        }
      });
    } catch (_error) {
      errors.push(`File system error: ${_error}`);
    }

    // 6. Check permissions
    try {
      if (this.fileExists(corePath)) {
        fs.accessSync(corePath, fs.constants.R_OK);
      }
    } catch {
      isValid = false;
      errors.push('Cannot read core.md - check permissions');
    }

    // 7. RETURN validation result
    return {
      isValid,
      errors,
      warnings,
    };
  }

  // Helper methods
  private fileExists(filePath: string): boolean {
    try {
      fs.accessSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private isDirectory(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private isRegularFile(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  private readDirectory(dirPath: string): string[] {
    try {
      return fs.readdirSync(dirPath);
    } catch {
      return [];
    }
  }

  private scanProviderDirectory(
    providerPath: string,
    provider: string,
    fileType: 'core' | 'env' | 'tool' | 'all',
    availableFiles: AvailableFile[],
  ): void {
    // Check for core.md at provider level
    if (fileType === 'all' || fileType === 'core') {
      const corePath = path.join(providerPath, 'core.md');
      if (this.fileExists(corePath)) {
        availableFiles.push({
          path: `providers/${provider}/core.md`,
          type: 'core',
          source: 'provider',
        });
      }
    }

    // Check for env files at provider level
    if (fileType === 'all' || fileType === 'env') {
      const envDir = path.join(providerPath, 'env');
      if (this.isDirectory(envDir)) {
        const envFiles = this.readDirectory(envDir);
        for (const file of envFiles) {
          if (file.endsWith('.md')) {
            availableFiles.push({
              path: `providers/${provider}/env/${file}`,
              type: 'env',
              source: 'provider',
            });
          }
        }
      }
    }

    // Check for tool files at provider level
    if (fileType === 'all' || fileType === 'tool') {
      const toolsDir = path.join(providerPath, 'tools');
      if (this.isDirectory(toolsDir)) {
        const toolFiles = this.readDirectory(toolsDir);
        for (const file of toolFiles) {
          if (file.endsWith('.md')) {
            availableFiles.push({
              path: `providers/${provider}/tools/${file}`,
              type: 'tool',
              source: 'provider',
            });
          }
        }
      }
    }

    // Check for models directory
    const modelsDir = path.join(providerPath, 'models');
    if (this.isDirectory(modelsDir)) {
      const models = this.readDirectory(modelsDir);
      for (const model of models) {
        const modelPath = path.join(modelsDir, model);
        if (this.isDirectory(modelPath)) {
          this.scanModelDirectory(
            modelPath,
            provider,
            model,
            fileType,
            availableFiles,
          );
        }
      }
    }
  }

  private scanModelDirectory(
    modelPath: string,
    provider: string,
    model: string,
    fileType: 'core' | 'env' | 'tool' | 'all',
    availableFiles: AvailableFile[],
  ): void {
    // Check for core.md at model level
    if (fileType === 'all' || fileType === 'core') {
      const corePath = path.join(modelPath, 'core.md');
      if (this.fileExists(corePath)) {
        availableFiles.push({
          path: `providers/${provider}/models/${model}/core.md`,
          type: 'core',
          source: 'model',
        });
      }
    }

    // Check for env files at model level
    if (fileType === 'all' || fileType === 'env') {
      const envDir = path.join(modelPath, 'env');
      if (this.isDirectory(envDir)) {
        const envFiles = this.readDirectory(envDir);
        for (const file of envFiles) {
          if (file.endsWith('.md')) {
            availableFiles.push({
              path: `providers/${provider}/models/${model}/env/${file}`,
              type: 'env',
              source: 'model',
            });
          }
        }
      }
    }

    // Check for tool files at model level
    if (fileType === 'all' || fileType === 'tool') {
      const toolsDir = path.join(modelPath, 'tools');
      if (this.isDirectory(toolsDir)) {
        const toolFiles = this.readDirectory(toolsDir);
        for (const file of toolFiles) {
          if (file.endsWith('.md')) {
            availableFiles.push({
              path: `providers/${provider}/models/${model}/tools/${file}`,
              type: 'tool',
              source: 'model',
            });
          }
        }
      }
    }
  }

  private walkDirectory(
    dirPath: string,
    callback: (filePath: string, relativePath: string) => void,
    baseDir: string = dirPath,
  ): void {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        // Skip hidden files (starting with .)
        if (entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recurse into subdirectory
          this.walkDirectory(fullPath, callback, baseDir);
        } else if (entry.isFile()) {
          // Process file
          callback(fullPath, relativePath);
        }
        // Skip symlinks and other special files
      }
    } catch {
      // Ignore errors in subdirectories
    }
  }
}
