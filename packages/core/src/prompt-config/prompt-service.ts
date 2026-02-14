import { PromptCache, type CacheStats } from './prompt-cache.js';
import { PromptResolver } from './prompt-resolver.js';
import { PromptLoader, type EnvironmentInfo } from './prompt-loader.js';
import { TemplateEngine } from './TemplateEngine.js';
import { PromptInstaller, type DefaultsMap } from './prompt-installer.js';
import type { PromptContext } from './types.js';
import { ALL_DEFAULTS } from './defaults/index.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Configuration options for PromptService
 */
export interface PromptServiceConfig {
  /** Base directory for prompts (defaults to ~/.llxprt/prompts) */
  baseDir?: string;
  /** Maximum cache size in MB (defaults to 100) */
  maxCacheSizeMB?: number;
  /** Enable compression for loaded files (defaults to true) */
  compressionEnabled?: boolean;
  /** Enable debug mode for verbose logging */
  debugMode?: boolean;
}

/**
 * Result of configuration validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Main API that coordinates all prompt components
 */
export class PromptService {
  private baseDir: string;
  private cache: PromptCache;
  private resolver: PromptResolver;
  private loader: PromptLoader;
  private templateEngine: TemplateEngine;
  private installer: PromptInstaller;
  private defaultContent: DefaultsMap;
  private initialized: boolean;
  private config: Required<PromptServiceConfig>;
  private preloadedFiles: Map<string, string>;
  private _detectedEnvironment: EnvironmentInfo | null;
  private installerNotices: string[];
  private logger = new DebugLogger('llxprt:prompt-config:service');

  /**
   * Creates a new PromptService instance
   * @param config Optional configuration settings
   */
  constructor(config?: PromptServiceConfig) {
    // Set default configuration
    const defaultBaseDir = path.join(os.homedir(), '.llxprt', 'prompts');
    this.baseDir = this.expandPath(config?.baseDir ?? defaultBaseDir);

    this.config = {
      baseDir: this.baseDir,
      maxCacheSizeMB: config?.maxCacheSizeMB ?? 100,
      compressionEnabled: config?.compressionEnabled !== false,
      debugMode: config?.debugMode ?? false,
    };

    // Initialize components
    this.cache = new PromptCache(this.config.maxCacheSizeMB);
    this.resolver = new PromptResolver();
    this.loader = new PromptLoader(this.baseDir);
    this.templateEngine = new TemplateEngine();
    this.installer = new PromptInstaller();

    // Load default content
    this.defaultContent = { ...ALL_DEFAULTS };

    // Initialize state
    this.initialized = false;
    this.preloadedFiles = new Map();
    this._detectedEnvironment = null;
    this.installerNotices = [];

    // Environment detection reserved for future prompt customization
    void this._detectedEnvironment;
  }

  /**
   * Initialize the service, installing defaults and preloading files
   * @throws Error if initialization fails
   */
  async initialize(): Promise<void> {
    // Check if already initialized
    if (this.initialized) {
      return;
    }

    // Validate environment
    const baseDirParent = path.dirname(this.baseDir);
    if (!existsSync(baseDirParent)) {
      try {
        await fs.mkdir(baseDirParent, { recursive: true });
      } catch (error) {
        throw new Error(
          `Cannot create base directory: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Run installation
    const installResult = await this.installer.install(
      this.baseDir,
      this.defaultContent,
      {
        force: false,
        dryRun: false,
        verbose: this.config.debugMode,
      },
    );
    if (installResult.notices.length > 0) {
      this.installerNotices.push(...installResult.notices);
    }

    if (!installResult.success) {
      throw new Error(
        `Installation failed: ${installResult.errors.join(', ')}`,
      );
    }

    // Validate installation
    const validation = await this.installer.validate(this.baseDir);
    if (!validation.isValid && validation.errors.length > 0) {
      // Check for critical errors
      const criticalErrors = validation.errors.filter(
        (e) => e.includes('core') || e.includes('missing'),
      );
      if (criticalErrors.length > 0) {
        throw new Error(`Invalid installation: ${criticalErrors.join(', ')}`);
      }
      // Log warnings if debugMode
      if (this.config.debugMode && validation.warnings.length > 0) {
        this.logger.warn(() => `Installation warnings: ${validation.warnings}`);
      }
    }

    // Preload all files into memory
    const allFiles = await this.getAllPromptFiles(this.baseDir);
    for (const file of allFiles) {
      const loadResult = await this.loader.loadFile(
        file,
        this.config.compressionEnabled,
      );
      if (loadResult.success && loadResult.content) {
        this.preloadedFiles.set(file, loadResult.content);
      } else if (this.config.debugMode) {
        this.logger.warn(
          () => `Failed to preload file ${file}: ${loadResult.error}`,
        );
      }
    }

    // Detect environment
    this._detectedEnvironment = await this.loader.detectEnvironment(
      process.cwd(),
    );

    this.initialized = true;
  }

  /**
   * Consume any installer notices generated during initialization.
   * Returns the notices and clears the internal queue.
   */
  consumeInstallerNotices(): string[] {
    const notices = [...this.installerNotices];
    this.installerNotices = [];
    return notices;
  }

  /**
   * Get assembled prompt for the given context
   * @param context Runtime context with provider, model, tools, and environment
   * @param userMemory Optional user-specific content to include as context
   * @param coreMemory Optional core (system) memory to include as system directives
   * @returns Assembled prompt string
   * @throws Error if context is invalid or core prompt is missing
   */
  async getPrompt(
    context: PromptContext,
    userMemory?: string | null,
    coreMemory?: string | null,
  ): Promise<string> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Validate context
    if (!context) {
      throw new Error('Context is required');
    }
    if (!context.provider) {
      throw new Error('Provider is required');
    }
    if (!context.model) {
      throw new Error('Model is required');
    }

    // Check cache - we'll add core memory and user memory after cache retrieval
    const cached = this.cache.get(context);
    if (cached) {
      if (this.config.debugMode) {
        const cacheKey = this.cache.generateKey(context);
        this.logger.debug(() => `Cache hit: ${cacheKey}`);
      }
      return this.appendMemoryContent(
        cached.assembledPrompt,
        coreMemory,
        userMemory,
      );
    }

    // Resolve files
    const startTime = Date.now();
    const resolvedFiles = await this.resolver.resolveAllFiles(
      this.baseDir,
      context,
    );
    if (this.config.debugMode) {
      this.logger.debug(
        () =>
          `Resolved files: ${resolvedFiles.map((file) => file.path).join(', ')}`,
      );
    }

    // Load and process files
    const processedParts: string[] = [];
    const fileMetadata: string[] = [];

    // Process core file
    const coreFile = resolvedFiles.find((f) => f.type === 'core');
    if (coreFile) {
      const content = await this.loadAndProcess(coreFile.path, context, null);
      if (content) {
        processedParts.push(content);
        fileMetadata.push(coreFile.path);
      }
    } else {
      throw new Error('Core prompt not found');
    }

    // Process environment files
    const envFiles = resolvedFiles.filter((f) => f.type === 'env');
    for (const file of envFiles) {
      const content = await this.loadAndProcess(file.path, context, null);
      if (content) {
        processedParts.push(content);
        fileMetadata.push(file.path);
      }
    }

    // Process tool files
    const toolFiles = resolvedFiles.filter((f) => f.type === 'tool');
    for (const file of toolFiles) {
      const content = await this.loadAndProcess(
        file.path,
        context,
        file.toolName || null,
      );
      if (content) {
        processedParts.push(content);
        fileMetadata.push(file.path);
      }
    }

    // Assemble base prompt (without user memory)
    const baseAssembled = processedParts.join('\n\n');
    const assemblyTime = Date.now() - startTime;

    // Cache the base result (without memory content)
    const metadata = {
      files: fileMetadata,
      assemblyTimeMs: assemblyTime,
      tokenCount: this.estimateTokens(baseAssembled),
    };
    this.cache.set(context, baseAssembled, metadata);

    return this.appendMemoryContent(baseAssembled, coreMemory, userMemory);
  }

  /**
   * Appends core memory (system directives) and user memory (context) to
   * the base assembled prompt. Core memory is placed directly after the base
   * prompt as system-level content. User memory follows with a `---` separator.
   */
  private appendMemoryContent(
    basePrompt: string,
    coreMemory?: string | null,
    userMemory?: string | null,
  ): string {
    let result = basePrompt;

    // Core memory: injected as system directives (no --- separator)
    if (coreMemory && coreMemory.trim()) {
      result += `\n\n${coreMemory.trim()}`;
    }

    // User memory: injected as user context with --- separator
    if (userMemory && userMemory.trim()) {
      result += `\n\n---\n\n${userMemory.trim()}`;
    }

    return result;
  }

  /**
   * Load a specific prompt file by relative path
   * @param relativePath Path relative to the prompts directory (e.g., 'services/loop-detection.md')
   * @returns The prompt content
   * @throws Error if file cannot be loaded
   */
  async loadPrompt(relativePath: string): Promise<string> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    const fullPath = path.join(this.baseDir, relativePath);
    const result = await this.loader.loadFile(fullPath, false);

    if (!result.success) {
      throw new Error(`Failed to load prompt ${relativePath}: ${result.error}`);
    }

    return result.content.trim();
  }

  /**
   * Clear the prompt cache
   */
  clearCache(): void {
    this.cache.clear();
    if (this.config.debugMode) {
      this.logger.debug(() => 'Cache cleared');
    }
  }

  /**
   * Get cache statistics
   * @returns Cache statistics including size, count, and hit rate
   */
  getCacheStats(): CacheStats & { totalEntries: number; hitRate: number } {
    const stats = this.cache.getStats();

    // Calculate hit rate: total accesses includes initial creation + subsequent hits
    // So hits = totalAccesses (which counts cache hits only, not initial sets)
    const totalRequests = stats.entryCount + stats.totalAccesses;
    const hits = stats.totalAccesses;
    const hitRate = totalRequests > 0 ? (hits / totalRequests) * 100 : 0;

    // Add properties expected by tests
    return {
      ...stats,
      totalEntries: stats.entryCount,
      hitRate,
    };
  }

  /**
   * Reload all files from disk and clear cache
   * @throws Error if reloading fails
   */
  async reloadFiles(): Promise<void> {
    // Clear the cache
    this.clearCache();

    // Clear memory cache of files
    this.preloadedFiles.clear();

    // Re-run initialization
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Validate a context configuration
   * @param context Context to validate
   * @returns Validation result with errors and warnings
   */
  validateConfiguration(context: PromptContext): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let isValid = true;

    // Check required fields
    if (!context.provider) {
      errors.push('Provider is required');
      isValid = false;
    }
    if (!context.model) {
      errors.push('Model is required');
      isValid = false;
    }

    // Check provider/model format
    const invalidCharsRegex = /[^a-zA-Z0-9\-_.]/;
    if (context.provider && invalidCharsRegex.test(context.provider)) {
      warnings.push('Provider will be sanitized');
    }
    if (context.model && invalidCharsRegex.test(context.model)) {
      warnings.push('Model will be sanitized');
    }

    // Check tools
    if (context.enabledTools) {
      for (const tool of context.enabledTools) {
        if (typeof tool !== 'string') {
          errors.push('Invalid tool: must be string');
          isValid = false;
        }
      }
    }

    // Check environment
    if (context.environment) {
      const booleanKeys = [
        'isGitRepository',
        'isSandboxed',
        'hasIdeCompanion',
      ] as const;
      for (const key of booleanKeys) {
        if (
          key in context.environment &&
          typeof context.environment[key] !== 'boolean'
        ) {
          warnings.push(`${key} should be boolean`);
        }
      }
    }

    return {
      isValid,
      errors,
      warnings,
    };
  }

  /**
   * Get list of available tool prompts
   * @returns Array of tool names in PascalCase
   */
  async getAvailableTools(): Promise<string[]> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // List tool files
    const toolsDir = path.join(this.baseDir, 'tools');
    if (!existsSync(toolsDir)) {
      return [];
    }

    try {
      // Extract tool names
      const toolNames: string[] = [];
      const files = await fs.readdir(toolsDir);

      for (const file of files) {
        if (file.endsWith('.md')) {
          // Remove .md extension
          const baseName = file.slice(0, -3);
          // Convert from kebab-case to PascalCase
          const pascalCase = baseName
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
          toolNames.push(pascalCase);
        }
      }

      // Sort and return
      return toolNames.sort();
    } catch (error) {
      // Directory read fails: Return empty array
      if (this.config.debugMode) {
        this.logger.error(() => `Failed to read tools directory: ${error}`, {
          error,
        });
      }
      return [];
    }
  }

  /**
   * Helper method to expand tilde in paths
   */
  private expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  /**
   * Helper method to load and process a file with template substitution
   */
  private async loadAndProcess(
    filePath: string,
    context: PromptContext,
    currentTool: string | null,
  ): Promise<string> {
    // Read from memory cache
    let content = this.preloadedFiles.get(filePath);

    if (!content) {
      // If not in memory, try loading directly
      const loadResult = await this.loader.loadFile(
        filePath,
        this.config.compressionEnabled,
      );
      if (!loadResult.success || !loadResult.content) {
        if (this.config.debugMode) {
          this.logger.error(
            () => `Failed to load file ${filePath}: ${loadResult.error}`,
            { error: loadResult.error },
          );
        }
        return '';
      }
      content = loadResult.content;
    }

    // Create template variables
    const variables = this.templateEngine.createVariablesFromContext(
      context,
      currentTool,
    );

    // Process template
    let processedContent: string;
    try {
      processedContent = this.templateEngine.processTemplate(
        content,
        variables,
      );
    } catch (error) {
      // Template processing fails: Return original content
      if (this.config.debugMode) {
        this.logger.error(
          () => `Failed to process template for ${filePath}: ${error}`,
          { error },
        );
      }
      processedContent = content;
    }

    return processedContent;
  }

  /**
   * Helper method to get all prompt files recursively
   */
  private async getAllPromptFiles(baseDir: string): Promise<string[]> {
    const files: string[] = [];

    async function walkDir(dir: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (
            entry.isDirectory() &&
            entry.name !== '.' &&
            entry.name !== '..'
          ) {
            await walkDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      } catch (_error) {
        // Permission denied or invalid paths: Skip
        // Silent failure as per pseudocode
      }
    }

    await walkDir(baseDir);
    return files;
  }

  /**
   * Helper method to estimate tokens in text
   */
  private estimateTokens(text: string): number {
    if (!text) {
      return 0;
    }

    // Basic estimation without tokenizer
    const wordCount = text.split(/\s+/).length;
    const characterCount = text.length;
    const estimate = Math.max(wordCount * 1.3, characterCount / 4);

    return Math.round(estimate);
  }
}
