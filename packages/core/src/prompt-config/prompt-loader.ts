/**
 * Prompt Loader - Handles reading prompt files from disk with compression support
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { existsSync } from 'fs';

// Types for file loading results
export interface LoadFileResult {
  success: boolean;
  content: string;
  error: string | null;
}

// Types for environment detection
export interface EnvironmentInfo {
  isGitRepository: boolean;
  isSandboxed: boolean;
  hasIdeCompanion: boolean;
}

// Types for file watching
export interface FileWatcher {
  stop(): void;
}

export type FileChangeCallback = (
  eventType: string,
  relativePath: string,
) => void;

/**
 * PromptLoader handles file I/O operations for prompt configuration files
 */
export class PromptLoader {
  private baseDir: string;
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Load a single file with optional compression
   */
  async loadFile(
    filePath: string,
    shouldCompress: boolean,
  ): Promise<LoadFileResult> {
    // Step 1: Validate input
    if (filePath === null || filePath === undefined) {
      return { success: false, content: '', error: 'Invalid file path' };
    }

    // Check for path traversal
    const normalizedPath = path.normalize(filePath);
    const resolvedPath = path.resolve(filePath);
    const resolvedBaseDir = path.resolve(this.baseDir);

    if (
      normalizedPath.includes('..') ||
      !resolvedPath.startsWith(resolvedBaseDir)
    ) {
      return { success: false, content: '', error: 'Path traversal detected' };
    }

    try {
      // Step 2: Check file size before reading
      // Use lstat to detect symbolic links
      const stats = await fs.lstat(filePath);

      if (stats.isSymbolicLink()) {
        return { success: false, content: '', error: 'Not a regular file' };
      }

      if (!stats.isFile()) {
        return { success: false, content: '', error: 'Not a regular file' };
      }

      if (stats.size > PromptLoader.MAX_FILE_SIZE) {
        return { success: false, content: '', error: 'File too large' };
      }

      // Step 3: Read file content
      let rawContent: string;
      try {
        rawContent = await fs.readFile(filePath, 'utf8');
      } catch (readError) {
        return {
          success: false,
          content: '',
          error: `Failed to read file: ${readError instanceof Error ? readError.message : 'Unknown error'}`,
        };
      }

      // Step 4: Validate UTF-8 encoding
      // Node.js will throw an error if the file is not valid UTF-8 when reading with 'utf8'
      // However, we need to check for specific invalid sequences
      if (this.containsInvalidUtf8(rawContent)) {
        return { success: false, content: '', error: 'Invalid UTF-8 encoding' };
      }

      // Step 5: Apply compression if requested
      const finalContent = shouldCompress
        ? this.compressContent(rawContent)
        : rawContent;

      return { success: true, content: finalContent, error: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: false, content: '', error: 'File not found' };
      }
      return {
        success: false,
        content: '',
        error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check if content contains invalid UTF-8 sequences
   */
  private containsInvalidUtf8(content: string): boolean {
    // Check for replacement character which indicates invalid UTF-8
    return content.includes('\ufffd');
  }

  /**
   * Compress content according to prompt configuration rules
   */
  compressContent(content: string): string {
    // Step 1: Handle empty or null content
    if (!content) {
      return '';
    }

    // Step 2: Initialize compression state
    const lines = content.split(/\r?\n/); // Handle both \n and \r\n
    const compressedLines: string[] = [];
    let inCodeBlock = false;
    let lastLineWasEmpty = false;
    let codeBlockDelimiter: string | null = null;

    // Step 3: Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip the last empty line if it's from a trailing newline
      if (i === lines.length - 1 && line === '' && content.endsWith('\n')) {
        continue;
      }
      // Check for code block boundaries
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockDelimiter = line;
        } else if (line === codeBlockDelimiter || line === '```') {
          inCodeBlock = false;
          codeBlockDelimiter = null;
        }
        compressedLines.push(line);
        lastLineWasEmpty = false;
        continue;
      }

      if (inCodeBlock) {
        compressedLines.push(line);
        lastLineWasEmpty = false;
        continue;
      }

      // Apply prose compression rules
      let compressedLine = line;

      // Simplify headers
      compressedLine = compressedLine.replace(/^#{2,}\s+(.+)$/, '# $1');

      // Simplify bold list items
      compressedLine = compressedLine.replace(
        /^(\s*)-\s+\*\*(.+?)\*\*:\s*(.*)$/,
        '$1- $2: $3',
      );

      // Remove excessive whitespace
      // For list items, preserve leading spaces (indentation)
      if (
        compressedLine.match(/^\s*[-*+]\s/) ||
        compressedLine.match(/^\s*\d+\.\s/)
      ) {
        const leadingSpaces = compressedLine.match(/^\s*/)?.[0] || '';
        compressedLine =
          leadingSpaces + compressedLine.trim().replace(/\s+/g, ' ');
      } else {
        // For non-list items, remove all leading/trailing whitespace
        compressedLine = compressedLine.trim().replace(/\s+/g, ' ');
      }

      // Handle blank lines
      if (compressedLine === '') {
        if (lastLineWasEmpty) {
          continue; // Skip multiple blank lines
        } else {
          lastLineWasEmpty = true;
        }
      } else {
        lastLineWasEmpty = false;
      }

      compressedLines.push(compressedLine);
    }

    return compressedLines.join('\n');
  }

  /**
   * Load multiple files and return a map of path to content
   */
  async loadAllFiles(
    baseDir: string,
    fileList: string[],
    shouldCompress: boolean,
  ): Promise<Map<string, string>> {
    // Step 1: Validate inputs
    if (!baseDir || !fileList) {
      return new Map();
    }

    // Step 2: Initialize result map
    const fileContents = new Map<string, string>();

    // Step 3: Process each file
    for (const relativePath of fileList) {
      const absolutePath = path.join(baseDir, relativePath);

      const result = await this.loadFile(absolutePath, shouldCompress);

      if (result.success) {
        fileContents.set(relativePath, result.content);
      } else {
        // Log warning but continue processing other files
        console.warn(`Failed to load ${relativePath}: ${result.error}`);
      }
    }

    return fileContents;
  }

  /**
   * Detect environment characteristics
   */
  detectEnvironment(workingDirectory: string): EnvironmentInfo {
    // Step 1: Detect Git repository
    let isGitRepository = false;
    let currentDir = workingDirectory;

    try {
      while (currentDir !== path.dirname(currentDir)) {
        // Not at root
        if (existsSync(path.join(currentDir, '.git'))) {
          isGitRepository = true;
          break;
        }
        currentDir = path.dirname(currentDir);
      }
    } catch {
      // Permission errors default to false
      isGitRepository = false;
    }

    // Step 2: Detect sandbox environment
    let isSandboxed = false;

    if (process.env.SANDBOX === '1' || process.env.SANDBOX === 'true') {
      isSandboxed = true;
    } else if (
      process.env.CONTAINER === '1' ||
      process.env.CONTAINER === 'true'
    ) {
      isSandboxed = true;
    } else if (existsSync('/sandbox') || existsSync('/.dockerenv')) {
      isSandboxed = true;
    }

    // Step 3: Detect IDE companion
    let hasIdeCompanion = false;

    if (
      process.env.IDE_COMPANION === '1' ||
      process.env.IDE_COMPANION === 'true'
    ) {
      hasIdeCompanion = true;
    } else if (existsSync(path.join(workingDirectory, '.vscode'))) {
      hasIdeCompanion = true;
    } else if (existsSync(path.join(workingDirectory, '.idea'))) {
      hasIdeCompanion = true;
    }

    return {
      isGitRepository,
      isSandboxed,
      hasIdeCompanion,
    };
  }

  /**
   * Watch files for changes
   */
  watchFiles(
    baseDir: string,
    callback: FileChangeCallback,
  ): FileWatcher | null {
    // Step 1: Validate inputs
    if (!existsSync(baseDir)) {
      return null;
    }

    if (typeof callback !== 'function') {
      return null;
    }

    // Step 2: Set up file watcher
    let watcher: {
      close(): void;
      on(event: string, handler: (path: string) => void): void;
    };
    const timeouts = new Map<string, NodeJS.Timeout>();

    try {
      // Try to use chokidar if available
      // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
      const chokidar = require('chokidar');

      watcher = chokidar.watch(baseDir, {
        persistent: true,
        recursive: true,
        ignoreInitial: true,
        ignored: (path: string) => !path.endsWith('.md'),
      });

      // Step 3: Handle file change events with debouncing
      const handleChange = (eventType: string, filePath: string) => {
        const relativePath = path.relative(baseDir, filePath);

        // Only process .md files
        if (!relativePath.endsWith('.md')) {
          return;
        }

        // Debounce events
        if (timeouts.has(relativePath)) {
          clearTimeout(timeouts.get(relativePath)!);
        }

        timeouts.set(
          relativePath,
          setTimeout(() => {
            callback(eventType, relativePath);
            timeouts.delete(relativePath);
          }, 100),
        ); // 100ms debounce
      };

      watcher.on('add', (filePath: string) => handleChange('add', filePath));
      watcher.on('change', (filePath: string) =>
        handleChange('change', filePath),
      );
      watcher.on('unlink', (filePath: string) =>
        handleChange('unlink', filePath),
      );

      // Step 4: Return watcher control object
      return {
        stop: () => {
          // Clear all pending timeouts
          for (const timeout of timeouts.values()) {
            clearTimeout(timeout);
          }
          timeouts.clear();

          // Close the watcher
          if (watcher && typeof watcher.close === 'function') {
            watcher.close();
          }
        },
      };
    } catch {
      // If chokidar is not available, use fs.watch as fallback
      try {
        const fsWatcher = fsSync.watch(baseDir, { recursive: true });

        // Note: fs.watch has limitations but works as a fallback
        fsWatcher.on(
          'change',
          (eventType: string | null, filename: string | Buffer | null) => {
            if (filename) {
              const filenameStr =
                typeof filename === 'string' ? filename : filename.toString();
              if (filenameStr.endsWith('.md')) {
                // Simple debouncing
                if (timeouts.has(filenameStr)) {
                  clearTimeout(timeouts.get(filenameStr)!);
                }

                timeouts.set(
                  filenameStr,
                  setTimeout(() => {
                    callback(eventType || 'change', filenameStr);
                    timeouts.delete(filenameStr);
                  }, 100),
                );
              }
            }
          },
        );

        return {
          stop: () => {
            for (const timeout of timeouts.values()) {
              clearTimeout(timeout);
            }
            timeouts.clear();
            fsWatcher.close();
          },
        };
      } catch {
        return null;
      }
    }
  }
}
