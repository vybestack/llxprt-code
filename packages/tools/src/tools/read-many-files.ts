/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { getErrorMessage } from '../utils/errors.js';
import * as fs from 'fs';
import * as path from 'path';
import { glob, escape as globEscape } from 'glob';
import {
  detectFileType,
  processSingleFileContent,
  DEFAULT_ENCODING,
  getSpecificMimeType,
  DEFAULT_MAX_LINES_TEXT_FILE,
} from '../utils/fileUtils.js';
import { type PartUnion } from '@google/genai';
import { stat } from 'fs/promises';
import { ToolErrorType } from '../types/tool-error.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import {
  buildParameterSchema,
  formatExcludePatterns,
} from './read-many-files-schema.js';

// Simple token estimation - roughly 4 characters per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type AddFileContentAction = 'continue' | 'stop' | 'stopAfterRecord';

interface AddFileContentResult {
  totalTokens: number;
  action: AddFileContentAction;
}

/**
 * Parameters for the ReadManyFilesTool.
 */
export interface ReadManyFilesParams {
  /**
   * An array of file paths or directory paths to search within.
   * Paths are relative to the tool's configured target directory.
   * Glob patterns can be used directly in these paths.
   */
  paths: string[];

  /**
   * Optional. Glob patterns for files to include.
   * These are effectively combined with the `paths`.
   * Example: ["*.ts", "src/** /*.md"]
   */
  include?: string[];

  /**
   * Optional. Glob patterns for files/directories to exclude.
   * Applied as ignore patterns.
   * Example: ["*.log", "dist/**"]
   */
  exclude?: string[];

  /**
   * Optional. Search directories recursively.
   * This is generally controlled by glob patterns (e.g., `**`).
   * The glob implementation is recursive by default for `**`.
   * For simplicity, we'll rely on `**` for recursion.
   */
  recursive?: boolean;

  /**
   * Optional. Apply default exclusion patterns. Defaults to true.
   */
  useDefaultExcludes?: boolean;

  /**
   * Whether to respect .gitignore and .llxprtignore patterns (optional, defaults to true)
   */
  file_filtering_options?: {
    respect_git_ignore?: boolean;
    respect_llxprt_ignore?: boolean;
  };
}

/**
 * Creates the default exclusion patterns including dynamic patterns.
 * This combines the shared patterns with dynamic patterns like LLXPRT.md.
 * Task(adh): Consider making this configurable or extendable through a command line argument.
 */
function getDefaultExcludes(host?: IToolHost): string[] {
  return host?.getReadManyFilesExclusions() ?? [];
}

const DEFAULT_OUTPUT_SEPARATOR_FORMAT = '--- {filePath} ---';
const DEFAULT_OUTPUT_TERMINATOR = '\n--- End of content ---';

// Default limits for ReadManyFiles
const DEFAULT_MAX_FILE_COUNT = 50;
const DEFAULT_MAX_TOKENS = 50000;
const DEFAULT_TRUNCATE_MODE = 'warn';
const DEFAULT_FILE_SIZE_LIMIT = 524288; // 512KB

class ReadManyFilesToolInvocation extends BaseToolInvocation<
  ReadManyFilesParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    params: ReadManyFilesParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    const allPatterns = [...this.params.paths, ...(this.params.include ?? [])];
    const pathDesc = `using patterns: 
${allPatterns.join('`, `')}
 (within target directory: 
${this.host.getTargetDir()}
) `;

    // Determine the final list of exclusion patterns exactly as in execute method
    const paramExcludes = this.params.exclude ?? [];
    const paramUseDefaultExcludes = this.params.useDefaultExcludes !== false;
    const finalExclusionPatternsForDescription: string[] =
      paramUseDefaultExcludes
        ? [...getDefaultExcludes(this.host), ...paramExcludes]
        : [...paramExcludes];

    const excludeDesc =
      finalExclusionPatternsForDescription.length > 0
        ? formatExcludePatterns(finalExclusionPatternsForDescription)
        : 'none specified';

    return `Will attempt to read and concatenate files ${pathDesc}. ${excludeDesc}. File encoding: ${DEFAULT_ENCODING}. Separator: "${DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace(
      '{filePath}',
      'path/to/file.ext',
    )}".`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const {
      paths: inputPatterns,
      include = [],
      exclude = [],
      useDefaultExcludes = true,
    } = this.params;

    const { fileFilteringOptions, fileDiscovery, effectiveExcludes } =
      this.resolveFileParams(useDefaultExcludes, exclude);

    const filesToConsider = new Set<string>();
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const processedFilesRelativePaths: string[] = [];
    const contentParts: Array<string | PartUnion> = [];

    const searchResult = await this.discoverFiles(
      inputPatterns,
      include,
      effectiveExcludes,
      fileFilteringOptions,
      fileDiscovery,
      filesToConsider,
      skippedFiles,
      signal,
    );

    if (searchResult) {
      return searchResult;
    }

    const sortedFiles = Array.from(filesToConsider).sort();

    const limits = this.resolveLimits();
    const fileCountResult = this.applyFileCountLimit(
      sortedFiles,
      skippedFiles,
      limits,
    );
    if (fileCountResult) {
      return fileCountResult;
    }

    return this.processAndFormat(
      sortedFiles,
      inputPatterns,
      skippedFiles,
      processedFilesRelativePaths,
      contentParts,
      limits,
    );
  }

  private resolveFileParams(useDefaultExcludes: boolean, exclude: string[]) {
    const defaultFileIgnores = this.host.getFileFilteringOptions();
    const fileFilteringOptions = {
      respectGitIgnore:
        this.params.file_filtering_options?.respect_git_ignore ??
        defaultFileIgnores.respectGitIgnore,
      respectLlxprtIgnore:
        this.params.file_filtering_options?.respect_llxprt_ignore ??
        defaultFileIgnores.respectLlxprtIgnore,
    };
    const fileDiscovery = this.host.getFileService();
    const effectiveExcludes = useDefaultExcludes
      ? [...getDefaultExcludes(this.host), ...exclude]
      : [...exclude];
    return { fileFilteringOptions, fileDiscovery, effectiveExcludes };
  }

  private async processAndFormat(
    sortedFiles: string[],
    inputPatterns: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    processedFilesRelativePaths: string[],
    contentParts: Array<string | PartUnion>,
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
  ): Promise<ToolResult> {
    const totalTokens = await this.processFiles(
      sortedFiles,
      inputPatterns,
      skippedFiles,
      processedFilesRelativePaths,
      contentParts,
      limits,
    );

    const displayMessage = this.buildDisplayMessage(
      processedFilesRelativePaths,
      skippedFiles,
      totalTokens,
    );

    if (contentParts.length > 0) {
      contentParts.push(DEFAULT_OUTPUT_TERMINATOR);
    } else {
      contentParts.push(
        'No files matching the criteria were found or all were skipped.',
      );
    }
    return {
      llmContent: contentParts,
      returnDisplay: displayMessage.trim(),
    };
  }

  private async discoverFiles(
    inputPatterns: string[],
    include: string[],
    effectiveExcludes: string[],
    fileFilteringOptions: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
    },
    fileDiscovery: ReturnType<IToolHost['getFileService']>,
    filesToConsider: Set<string>,
    skippedFiles: Array<{ path: string; reason: string }>,
    signal: AbortSignal,
  ): Promise<ToolResult | undefined> {
    const searchPatterns = [...inputPatterns, ...include];
    try {
      const allEntries = new Set<string>();
      const workspaceDirs = this.host.getWorkspaceRoots();

      for (const dir of workspaceDirs) {
        const processedPatterns = this.processSearchPatterns(
          dir,
          searchPatterns,
        );
        const entriesInDir = await glob(processedPatterns, {
          cwd: dir,
          ignore: effectiveExcludes,
          nodir: true,
          dot: true,
          absolute: true,
          nocase: true,
          signal,
        });
        for (const entry of entriesInDir) {
          allEntries.add(entry);
        }
      }

      this.filterEntries(
        Array.from(allEntries),
        fileFilteringOptions,
        fileDiscovery,
        filesToConsider,
        skippedFiles,
      );
    } catch (error) {
      const errorMessage = `Error during file search: ${getErrorMessage(error)}`;
      return {
        llmContent: errorMessage,
        returnDisplay: `## File Search Error\n\nAn error occurred while searching for files:\n\`\`\`\n${getErrorMessage(error)}\n\`\`\``,
        error: {
          message: errorMessage,
          type: ToolErrorType.READ_MANY_FILES_SEARCH_ERROR,
        },
      };
    }
    return undefined;
  }

  private processSearchPatterns(
    dir: string,
    searchPatterns: string[],
  ): string[] {
    const processedPatterns = [];
    for (const p of searchPatterns) {
      const normalizedP = p.replace(/\\/g, '/');
      const fullPath = path.join(dir, normalizedP);

      if (fs.existsSync(fullPath)) {
        processedPatterns.push(globEscape(normalizedP));
      } else {
        processedPatterns.push(normalizedP);
      }
    }
    return processedPatterns;
  }

  private filterEntries(
    entries: string[],
    fileFilteringOptions: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
    },
    fileDiscovery: ReturnType<IToolHost['getFileService']>,
    filesToConsider: Set<string>,
    skippedFiles: Array<{ path: string; reason: string }>,
  ): void {
    let gitIgnoredCount = 0;
    let llxprtIgnoredCount = 0;

    for (const absoluteFilePath of entries) {
      const result = this.checkFileFilter(
        absoluteFilePath,
        fileFilteringOptions,
        fileDiscovery,
      );
      if (result.skipped) {
        if (result.reason) {
          skippedFiles.push({ path: absoluteFilePath, reason: result.reason });
        }
        if (result.type === 'git') gitIgnoredCount++;
        if (result.type === 'llxprt') llxprtIgnoredCount++;
        continue;
      }
      if (result.normalizedPath) {
        filesToConsider.add(result.normalizedPath);
      }
    }

    if (gitIgnoredCount > 0) {
      skippedFiles.push({
        path: `${gitIgnoredCount} file(s)`,
        reason: 'git ignored',
      });
    }

    if (llxprtIgnoredCount > 0) {
      skippedFiles.push({
        path: `${llxprtIgnoredCount} file(s)`,
        reason: 'llxprt ignored',
      });
    }
  }

  private checkFileFilter(
    absoluteFilePath: string,
    fileFilteringOptions: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
    },
    fileDiscovery: ReturnType<IToolHost['getFileService']>,
  ): {
    skipped: boolean;
    type?: 'security' | 'git' | 'llxprt';
    reason?: string;
    normalizedPath?: string;
  } {
    const pathError = validatePathWithinWorkspace(
      this.host.getWorkspaceRoots(),
      absoluteFilePath,
    );
    if (pathError) {
      return {
        skipped: true,
        type: 'security',
        reason: 'Security: ' + pathError,
      };
    }

    const normalizedPath = path.normalize(absoluteFilePath);

    // Use the unified decision path so that .llxprtignore negations can
    // un-ignore gitignored files when both flags are true.
    if (
      fileDiscovery.shouldIgnoreFile(absoluteFilePath, fileFilteringOptions)
    ) {
      // Categorize the skip reason for reporting. Prefer .llxprtignore when
      // it explicitly matched, because the unified decision above gives that
      // source precedence in combined mode. The dedicated check is intentionally
      // limited to skipped files so the public file-service API can remain boolean.
      const type: 'git' | 'llxprt' =
        fileFilteringOptions.respectLlxprtIgnore &&
        fileDiscovery.shouldLlxprtIgnoreFile(absoluteFilePath)
          ? 'llxprt'
          : 'git';
      return { skipped: true, type };
    }

    return { skipped: false, normalizedPath };
  }

  private resolveLimits(): {
    maxFileCount: number;
    maxTokens: number;
    truncateMode: 'warn' | 'truncate' | 'sample';
    fileSizeLimit: number;
  } {
    const ephemeralSettings = this.host.getEphemeralSettings();
    return {
      maxFileCount:
        (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
        DEFAULT_MAX_FILE_COUNT,
      maxTokens:
        (ephemeralSettings['tool-output-max-tokens'] as number | undefined) ??
        DEFAULT_MAX_TOKENS,
      truncateMode:
        (ephemeralSettings['tool-output-truncate-mode'] as
          | 'warn'
          | 'truncate'
          | 'sample'
          | undefined) ?? DEFAULT_TRUNCATE_MODE,
      fileSizeLimit:
        (ephemeralSettings['tool-output-item-size-limit'] as
          | number
          | undefined) ?? DEFAULT_FILE_SIZE_LIMIT,
    };
  }

  private applyFileCountLimit(
    sortedFiles: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
  ): ToolResult | undefined {
    if (sortedFiles.length <= limits.maxFileCount) {
      return undefined;
    }

    if (limits.truncateMode === 'warn') {
      const warnMessage = `Found ${sortedFiles.length} files matching your pattern, but limiting to ${limits.maxFileCount} files. Please use more specific patterns to narrow your search.`;
      return {
        llmContent: warnMessage,
        returnDisplay: `## File Count Limit Exceeded\n\n${warnMessage}\n\n**Matched files:** ${sortedFiles.length}\n**Limit:** ${limits.maxFileCount}\n\n**Suggestion:** Use more specific glob patterns or paths to reduce the number of matched files.`,
      };
    } else if (limits.truncateMode === 'sample') {
      const step = Math.ceil(sortedFiles.length / limits.maxFileCount);
      const sampledFiles: string[] = [];
      for (let i = 0; i < sortedFiles.length; i += step) {
        if (sampledFiles.length < limits.maxFileCount) {
          sampledFiles.push(sortedFiles[i]);
        }
      }
      const originalCount = sortedFiles.length;
      sortedFiles.length = 0;
      sortedFiles.push(...sampledFiles);
      skippedFiles.push({
        path: `${originalCount - sampledFiles.length} file(s)`,
        reason: `sampling to stay within ${limits.maxFileCount} file limit`,
      });
    } else {
      const truncatedCount = sortedFiles.length - limits.maxFileCount;
      sortedFiles.length = limits.maxFileCount;
      skippedFiles.push({
        path: `${truncatedCount} file(s)`,
        reason: `truncated to stay within ${limits.maxFileCount} file limit`,
      });
    }
    return undefined;
  }

  private async processFiles(
    sortedFiles: string[],
    inputPatterns: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    processedFilesRelativePaths: string[],
    contentParts: Array<string | PartUnion>,
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
  ): Promise<number> {
    let totalTokens = 0;
    for (const filePath of sortedFiles) {
      const result = await this.processSingleFile(
        filePath,
        sortedFiles,
        inputPatterns,
        skippedFiles,
        processedFilesRelativePaths,
        contentParts,
        limits,
        totalTokens,
      );
      if (result.done) {
        return result.totalTokens;
      }
      totalTokens = result.totalTokens;
    }
    return totalTokens;
  }

  private async processSingleFile(
    filePath: string,
    sortedFiles: string[],
    inputPatterns: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    processedFilesRelativePaths: string[],
    contentParts: Array<string | PartUnion>,
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
    currentTokens: number,
  ): Promise<{ done: boolean; totalTokens: number }> {
    const relativePathForDisplay = path
      .relative(this.host.getTargetDir(), filePath)
      .replace(/\\/g, '/');

    const sizeCheck = await this.checkFileSize(
      filePath,
      relativePathForDisplay,
      skippedFiles,
      limits.fileSizeLimit,
    );
    if (sizeCheck === 'skip') {
      return { done: false, totalTokens: currentTokens };
    }

    const assetCheck = await this.checkAssetFile(
      filePath,
      relativePathForDisplay,
      inputPatterns,
      skippedFiles,
    );
    if (assetCheck === 'skip') {
      return { done: false, totalTokens: currentTokens };
    }

    const fileReadResult = await this.readFileContent(filePath);
    if (fileReadResult.error) {
      skippedFiles.push({
        path: relativePathForDisplay,
        reason: `Read error: ${fileReadResult.error}`,
      });
      return { done: false, totalTokens: currentTokens };
    }

    const addResult = this.addFileContent(
      fileReadResult,
      filePath,
      relativePathForDisplay,
      skippedFiles,
      processedFilesRelativePaths,
      contentParts,
      limits,
      currentTokens,
      sortedFiles,
    );

    if (addResult.action === 'stop') {
      return { done: true, totalTokens: addResult.totalTokens };
    }

    processedFilesRelativePaths.push(relativePathForDisplay);
    this.recordReadMetric(filePath, fileReadResult.llmContent);
    if (addResult.action === 'stopAfterRecord') {
      return { done: true, totalTokens: addResult.totalTokens };
    }
    return { done: false, totalTokens: addResult.totalTokens };
  }

  private async checkFileSize(
    filePath: string,
    relativePathForDisplay: string,
    skippedFiles: Array<{ path: string; reason: string }>,
    fileSizeLimit: number,
  ): Promise<'skip' | 'continue'> {
    try {
      const stats = await stat(filePath);
      if (stats.size > fileSizeLimit) {
        skippedFiles.push({
          path: relativePathForDisplay,
          reason: `file size (${Math.round(stats.size / 1024)}KB) exceeds limit (${Math.round(fileSizeLimit / 1024)}KB)`,
        });
        return 'skip';
      }
    } catch (error) {
      skippedFiles.push({
        path: relativePathForDisplay,
        reason: `stat error: ${getErrorMessage(error)}`,
      });
      return 'skip';
    }
    return 'continue';
  }

  private async checkAssetFile(
    filePath: string,
    relativePathForDisplay: string,
    inputPatterns: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
  ): Promise<'skip' | 'continue'> {
    const fileType = await detectFileType(filePath);
    if (fileType === 'image' || fileType === 'pdf' || fileType === 'audio') {
      const fileExtension = path.extname(filePath).toLowerCase();
      const fileNameWithoutExtension = path.basename(filePath, fileExtension);
      const requestedExplicitly = inputPatterns.some(
        (pattern: string) =>
          pattern.toLowerCase().includes(fileExtension) ||
          pattern.includes(fileNameWithoutExtension),
      );

      if (!requestedExplicitly) {
        skippedFiles.push({
          path: relativePathForDisplay,
          reason:
            'asset file (image/pdf/audio) was not explicitly requested by name or extension',
        });
        return 'skip';
      }
    }
    return 'continue';
  }

  private async readFileContent(
    filePath: string,
  ): Promise<Awaited<ReturnType<typeof processSingleFileContent>>> {
    const maxLinesPerFile =
      (this.host.getEphemeralSettings()['file-read-max-lines'] as
        | number
        | undefined) ?? DEFAULT_MAX_LINES_TEXT_FILE;

    return processSingleFileContent(
      filePath,
      this.host.getTargetDir(),
      undefined,
      maxLinesPerFile,
    );
  }

  private addFileContent(
    fileReadResult: Awaited<ReturnType<typeof processSingleFileContent>>,
    filePath: string,
    relativePathForDisplay: string,
    skippedFiles: Array<{ path: string; reason: string }>,
    _processedFilesRelativePaths: string[],
    contentParts: Array<string | PartUnion>,
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
    totalTokens: number,
    sortedFiles: string[],
  ): AddFileContentResult {
    if (typeof fileReadResult.llmContent === 'string') {
      return this.addTextFileContent(
        fileReadResult,
        filePath,
        relativePathForDisplay,
        skippedFiles,
        contentParts,
        limits,
        totalTokens,
        sortedFiles,
        _processedFilesRelativePaths,
      );
    }

    // Non-text content (images/PDFs)
    const estimatedTokens = 85;

    if (totalTokens + estimatedTokens > limits.maxTokens) {
      skippedFiles.push({
        path: relativePathForDisplay,
        reason: 'would exceed token limit (non-text content)',
      });
      return { totalTokens, action: 'continue' };
    }
    totalTokens += estimatedTokens;
    contentParts.push(fileReadResult.llmContent);
    return { totalTokens, action: 'continue' };
  }

  private addTextFileContent(
    fileReadResult: Awaited<ReturnType<typeof processSingleFileContent>>,
    filePath: string,
    relativePathForDisplay: string,
    skippedFiles: Array<{ path: string; reason: string }>,
    contentParts: Array<string | PartUnion>,
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
    totalTokens: number,
    sortedFiles: string[],
    processedFilesRelativePaths: string[],
  ): AddFileContentResult {
    const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace(
      '{filePath}',
      filePath,
    );
    let fileContentForLlm = '';

    if (fileReadResult.isTruncated === true) {
      fileContentForLlm += `[WARNING: This file was truncated. To view the full content, use the 'read_file' tool on this specific file.]\n\n`;
    }
    fileContentForLlm += fileReadResult.llmContent as string;
    const contentToAdd = `${separator}\n\n${fileContentForLlm}\n\n`;
    const contentTokens = estimateTokens(contentToAdd);

    if (totalTokens + contentTokens > limits.maxTokens) {
      return this.handleTokenOverflow(
        limits,
        relativePathForDisplay,
        sortedFiles,
        processedFilesRelativePaths,
        contentParts,
        contentToAdd,
        totalTokens,
        skippedFiles,
      );
    }

    totalTokens += contentTokens;
    contentParts.push(contentToAdd);
    return { totalTokens, action: 'continue' };
  }

  private handleTokenOverflow(
    limits: ReturnType<ReadManyFilesToolInvocation['resolveLimits']>,
    relativePathForDisplay: string,
    sortedFiles: string[],
    processedFilesRelativePaths: string[],
    contentParts: Array<string | PartUnion>,
    contentToAdd: string,
    totalTokens: number,
    skippedFiles: Array<{ path: string; reason: string }>,
  ): AddFileContentResult {
    if (limits.truncateMode === 'warn') {
      skippedFiles.push({
        path: `${sortedFiles.length - processedFilesRelativePaths.length} remaining file(s)`,
        reason: `would exceed token limit of ${limits.maxTokens}`,
      });
      return { totalTokens, action: 'stop' };
    } else if (limits.truncateMode === 'truncate') {
      const remainingTokens = limits.maxTokens - totalTokens;
      if (remainingTokens > 100) {
        const truncatedContent = contentToAdd.substring(0, remainingTokens * 4);
        const finalContent =
          truncatedContent + '\n\n[CONTENT TRUNCATED DUE TO TOKEN LIMIT]';
        contentParts.push(finalContent);
        const updatedTokens = totalTokens + estimateTokens(finalContent);
        skippedFiles.push({
          path: relativePathForDisplay,
          reason: 'content truncated to fit token limit',
        });
        return { totalTokens: updatedTokens, action: 'stopAfterRecord' };
      }
      return { totalTokens, action: 'stop' };
    }
    skippedFiles.push({
      path: relativePathForDisplay,
      reason: 'skipped to stay within token limit',
    });
    return { totalTokens, action: 'continue' };
  }

  private recordReadMetric(
    filePath: string,
    llmContent: string | PartUnion,
  ): void {
    const lines =
      typeof llmContent === 'string'
        ? llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(filePath);
    this.host.recordFileRead(filePath, lines, mimetype);
  }

  private buildDisplayMessage(
    processedFilesRelativePaths: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    totalTokens: number,
  ): string {
    let displayMessage = `### ReadManyFiles Result (Target Dir: \`${this.host.getTargetDir()}\`)\n\n`;
    if (processedFilesRelativePaths.length > 0) {
      displayMessage += `Successfully read and concatenated content from **${processedFilesRelativePaths.length} file(s)**`;
      if (totalTokens > 0) {
        displayMessage += ` (approximately ${totalTokens.toLocaleString()} tokens)`;
      }
      displayMessage += `.\n`;
      if (processedFilesRelativePaths.length <= 10) {
        displayMessage += `\n**Processed Files:**\n`;
        processedFilesRelativePaths.forEach(
          (p) => (displayMessage += `- \`${p}\`\n`),
        );
      } else {
        displayMessage += `\n**Processed Files (first 10 shown):**\n`;
        processedFilesRelativePaths
          .slice(0, 10)
          .forEach((p) => (displayMessage += `- \`${p}\`\n`));
        displayMessage += `- ...and ${processedFilesRelativePaths.length - 10} more.\n`;
      }
    }

    if (skippedFiles.length > 0) {
      if (processedFilesRelativePaths.length === 0) {
        displayMessage += `No files were read and concatenated based on the criteria.\n`;
      }
      if (skippedFiles.length <= 5) {
        displayMessage += `\n**Skipped ${skippedFiles.length} item(s):**\n`;
      } else {
        displayMessage += `\n**Skipped ${skippedFiles.length} item(s) (first 5 shown):**\n`;
      }
      skippedFiles
        .slice(0, 5)
        .forEach(
          (f) => (displayMessage += `- \`${f.path}\` (Reason: ${f.reason})\n`),
        );
      if (skippedFiles.length > 5) {
        displayMessage += `- ...and ${skippedFiles.length - 5} more.\n`;
      }
    } else if (
      processedFilesRelativePaths.length === 0 &&
      skippedFiles.length === 0
    ) {
      displayMessage += `No files were read and concatenated based on the criteria.\n`;
    }

    return displayMessage;
  }
}

/**
 * Tool implementation for finding and reading multiple text files from the local filesystem
 * within a specified target directory. The content is concatenated.
 * It is intended to run in an environment with access to the local file system (e.g., a Node.js backend).
 */
export class ReadManyFilesTool extends BaseDeclarativeTool<
  ReadManyFilesParams,
  ToolResult
> {
  static readonly Name: string = 'read_many_files';

  constructor(private host: IToolHost) {
    super(
      ReadManyFilesTool.Name,
      'ReadManyFiles',
      `Reads content from multiple files specified by paths or glob patterns within a configured target directory. For text files, it concatenates their content into a single string. It is primarily designed for text-based files. However, it can also process image (e.g., .png, .jpg), audio (e.g., .mp3, .wav), and PDF (.pdf) files if their file names or extensions are explicitly included in the 'paths' argument. For these explicitly requested non-text files, their data is read and included in a format suitable for model consumption (e.g., base64 encoded).

This tool is useful when you need to understand or analyze a collection of files, such as:
- Getting an overview of a codebase or parts of it (e.g., all TypeScript files in the 'src' directory).
- Finding where specific functionality is implemented if the user asks broad questions about code.
- Reviewing documentation files (e.g., all Markdown files in the 'docs' directory).
- Gathering context from multiple configuration files.
- When the user asks to "read all files in X directory" or "show me the content of all Y files".

Use this tool when the user's query implies needing the content of several files simultaneously for context, analysis, or summarization. For text files, it uses default UTF-8 encoding and a '--- {filePath} ---' separator between file contents. The tool inserts a '--- End of content ---' after the last file. Ensure paths are relative to the target directory. Glob patterns like 'src/**/*.js' are supported. Avoid using for single files if a more specific single-file reading tool is available, unless the user specifically requests to process a list containing just one file via this tool. Other binary files (not explicitly requested as image/audio/PDF) are generally skipped. Default excludes apply to common non-text files (except for explicitly requested images/audio/PDFs) and large dependency directories unless 'useDefaultExcludes' is false.

IMPORTANT LIMITS:
- Maximum files: 50 (default, configurable via 'tool-output-max-items' setting)
- Maximum tokens: 50,000 (default, configurable via 'tool-output-max-tokens' setting)  
- Maximum file size: 512KB per file (configurable via 'tool-output-item-size-limit' setting)
- If limits are exceeded, the tool will warn and suggest more specific patterns (configurable behavior via 'tool-output-truncate-mode')`,
      Kind.Read,
      buildParameterSchema(),
    );
  }

  protected override createInvocation(
    params: ReadManyFilesParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<ReadManyFilesParams, ToolResult> {
    return new ReadManyFilesToolInvocation(this.host, params, messageBus);
  }

  async execute(
    params: ReadManyFilesParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    return this.build(params).execute(signal);
  }
}
