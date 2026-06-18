/**
 * Prompt Loader - Handles reading prompt files from disk with compression support
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'node:module';
import { debugLogger } from '../utils/debugLogger.js';

const requireFromHere = createRequire(import.meta.url);

interface ChokidarLike {
  watch(
    baseDir: string,
    options: {
      persistent: boolean;
      recursive: boolean;
      ignoreInitial: boolean;
      ignored: (watchPath: string) => boolean;
    },
  ): ChokidarWatcherLike;
}

interface ChokidarWatcherLike {
  on(
    event: 'add' | 'change' | 'unlink',
    listener: (filePath: string) => void,
  ): void;
  close(): void;
}
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
    filePath: string | null | undefined,
    shouldCompress: boolean,
  ): Promise<LoadFileResult> {
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
  compressContent(content: string | null | undefined): string {
    if (content === null || content === undefined || content === '') {
      return '';
    }

    const state = {
      inCodeBlock: false,
      lastLineWasEmpty: false,
      codeBlockDelimiter: null as string | null,
      compressedLines: [] as string[],
    };

    const lines = content.split(/\r?\n/);
    const lastIndex = lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
      if (i !== lastIndex || lines[i] !== '' || !content.endsWith('\n')) {
        this.appendCompressedLine(lines[i], state);
      }
    }

    return state.compressedLines.join('\n');
  }

  private appendCompressedLine(
    line: string,
    state: {
      inCodeBlock: boolean;
      lastLineWasEmpty: boolean;
      codeBlockDelimiter: string | null;
      compressedLines: string[];
    },
  ): void {
    const codeBlockChanged = this.appendCodeBlockLine(line, state);
    if (codeBlockChanged) {
      return;
    }

    if (state.inCodeBlock) {
      state.compressedLines.push(line);
      state.lastLineWasEmpty = false;
      return;
    }

    const compressedLine = this.compressProseLine(line);
    if (compressedLine === '' && state.lastLineWasEmpty) {
      return;
    }

    state.lastLineWasEmpty = compressedLine === '';
    state.compressedLines.push(compressedLine);
  }

  private appendCodeBlockLine(
    line: string,
    state: {
      inCodeBlock: boolean;
      lastLineWasEmpty: boolean;
      codeBlockDelimiter: string | null;
      compressedLines: string[];
    },
  ): boolean {
    if (!line.startsWith('```')) {
      return false;
    }

    if (!state.inCodeBlock) {
      state.inCodeBlock = true;
      state.codeBlockDelimiter = line;
    } else if (line === state.codeBlockDelimiter || line === '```') {
      state.inCodeBlock = false;
      state.codeBlockDelimiter = null;
    }
    state.compressedLines.push(line);
    state.lastLineWasEmpty = false;
    return true;
  }

  private compressProseLine(line: string): string {
    const simplifiedLine = this.simplifyBoldListItem(
      this.simplifyHeaderLine(line),
    );

    if (this.isListItem(simplifiedLine)) {
      const leadingSpaces = this.leadingSpaces(simplifiedLine);
      return leadingSpaces + this.collapseWhitespace(simplifiedLine.trim());
    }

    return this.collapseWhitespace(simplifiedLine.trim());
  }

  private simplifyHeaderLine(line: string): string {
    const trimmedStart = line.trimStart();
    const leadingLength = line.length - trimmedStart.length;
    const hashCount = this.countLeadingChar(trimmedStart, '#');
    if (hashCount < 2 || trimmedStart[hashCount] !== ' ') {
      return line;
    }
    return `${line.slice(0, leadingLength)}# ${trimmedStart.slice(hashCount + 1)}`;
  }

  private simplifyBoldListItem(line: string): string {
    const markerIndex = line.indexOf('- **');
    if (markerIndex < 0) {
      return line;
    }
    const boldStart = markerIndex + 4;
    const boldEnd = line.indexOf('**:', boldStart);
    if (boldEnd < 0) {
      return line;
    }
    const prefix = line.slice(0, markerIndex + 2);
    const label = line.slice(boldStart, boldEnd);
    const suffix = line.slice(boldEnd + 3).trimStart();
    return `${prefix}${label}: ${suffix}`;
  }

  private isListItem(line: string): boolean {
    const trimmed = line.trimStart();
    return this.isUnorderedListItem(trimmed) || this.isOrderedListItem(trimmed);
  }

  private isUnorderedListItem(trimmed: string): boolean {
    return ['-', '*', '+'].some((marker) => trimmed.startsWith(`${marker} `));
  }

  private isOrderedListItem(trimmed: string): boolean {
    const dotIndex = trimmed.indexOf('. ');
    return dotIndex > 0 && this.isAllDigits(trimmed.slice(0, dotIndex));
  }

  private isAllDigits(value: string): boolean {
    return (
      value.length > 0 && [...value].every((char) => char >= '0' && char <= '9')
    );
  }

  private leadingSpaces(value: string): string {
    return value.slice(0, value.length - value.trimStart().length);
  }

  private collapseWhitespace(value: string): string {
    return value.split(/\s+/u).join(' ');
  }

  private countLeadingChar(value: string, char: string): number {
    let count = 0;
    while (value[count] === char) {
      count++;
    }
    return count;
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
    if (
      (baseDir as unknown) == null ||
      baseDir === '' ||
      (fileList as unknown) == null ||
      fileList.length === 0
    ) {
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
        debugLogger.warn(`Failed to load ${relativePath}: ${result.error}`);
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
    const isSandboxed = this.detectSandboxEnvironment();

    // Step 3: Detect IDE companion
    const hasIdeCompanion =
      process.env.IDE_COMPANION === '1' ||
      process.env.IDE_COMPANION === 'true' ||
      existsSync(path.join(workingDirectory, '.vscode')) ||
      existsSync(path.join(workingDirectory, '.idea'));

    return {
      isGitRepository,
      isSandboxed,
      hasIdeCompanion,
    };
  }

  private detectSandboxEnvironment(): boolean {
    return [
      process.env.SANDBOX === '1',
      process.env.SANDBOX === 'true',
      process.env.CONTAINER === '1',
      process.env.CONTAINER === 'true',
      existsSync('/sandbox'),
      existsSync('/.dockerenv'),
    ].some(Boolean);
  }

  /**
   * Create a chokidar-based file watcher
   */
  private createChokidarWatcher(
    baseDir: string,
    handleChange: (eventType: string, filePath: string) => void,
    timeouts: Map<string, NodeJS.Timeout>,
  ): FileWatcher | null {
    const chokidar = requireFromHere('chokidar') as ChokidarLike;

    const watcher = chokidar.watch(baseDir, {
      persistent: true,
      recursive: true,
      ignoreInitial: true,
      ignored: (watchPath: string) => !watchPath.endsWith('.md'),
    });

    watcher.on('add', (filePath: string) => handleChange('add', filePath));
    watcher.on('change', (filePath: string) =>
      handleChange('change', filePath),
    );
    watcher.on('unlink', (filePath: string) =>
      handleChange('unlink', filePath),
    );

    return {
      stop: () => {
        for (const timeout of timeouts.values()) {
          clearTimeout(timeout);
        }
        timeouts.clear();
        watcher.close();
      },
    };
  }

  /** Handle a file change from fs.watch fallback with debouncing */
  private handleFsWatchChange(
    eventType: string | null,
    filename: string | Buffer | null,
    callback: FileChangeCallback,
    timeouts: Map<string, NodeJS.Timeout>,
  ): void {
    if (filename === null) {
      return;
    }
    const filenameStr =
      typeof filename === 'string' ? filename : filename.toString();
    if (!filenameStr.endsWith('.md')) {
      return;
    }
    if (timeouts.has(filenameStr)) {
      clearTimeout(timeouts.get(filenameStr));
    }

    timeouts.set(
      filenameStr,
      setTimeout(() => {
        callback(
          eventType === null || eventType === '' ? 'change' : eventType,
          filenameStr,
        );
        timeouts.delete(filenameStr);
      }, 100),
    );
  }

  /**
   * Create an fs.watch-based fallback file watcher
   */
  private createFsWatcher(
    baseDir: string,
    callback: FileChangeCallback,
    timeouts: Map<string, NodeJS.Timeout>,
  ): FileWatcher | null {
    try {
      const fsWatcher = fsSync.watch(baseDir, { recursive: true });

      fsWatcher.on(
        'change',
        (eventType: string | null, filename: string | Buffer | null) => {
          this.handleFsWatchChange(eventType, filename, callback, timeouts);
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

    // Step 2: Set up debounced change handler
    const timeouts = new Map<string, NodeJS.Timeout>();

    const handleChange = (eventType: string, filePath: string) => {
      const relativePath = path.relative(baseDir, filePath);

      if (!relativePath.endsWith('.md')) {
        return;
      }

      if (timeouts.has(relativePath)) {
        clearTimeout(timeouts.get(relativePath));
      }

      timeouts.set(
        relativePath,
        setTimeout(() => {
          callback(eventType, relativePath);
          timeouts.delete(relativePath);
        }, 100),
      );
    };

    // Step 3: Try chokidar first, then fallback to fs.watch
    try {
      const chokidarWatcher = this.createChokidarWatcher(
        baseDir,
        handleChange,
        timeouts,
      );
      if (chokidarWatcher) {
        return chokidarWatcher;
      }
    } catch {
      // chokidar not available
    }

    return this.createFsWatcher(baseDir, callback, timeouts);
  }
}
