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
import { globStream, escape as globEscape } from 'glob';
import {
  createImageConfigurationToolResult,
  getImageBudgetToolResult,
  getImageResizeToolResult,
  getProcessedFileSkipReason,
  processSingleFileContent,
  DEFAULT_ENCODING,
  DEFAULT_MAX_LINES_TEXT_FILE,
  getSpecificMimeType,
} from '../utils/fileUtils.js';
import { runPreReadGates } from '../utils/fileBudgetChecks.js';
import { type ContentPartUnion } from '../types/wire-types.js';
import { ToolErrorType } from '../types/tool-error.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import {
  resolveImageResizePolicy,
  type ImageResizePolicy,
} from '../utils/imageResize.js';
import {
  resolveImageDimensionBudget,
  type ImageDimensionBudget,
} from '../utils/imageDimensionBudget.js';
import {
  addFileContent,
  DEFAULT_OUTPUT_SEPARATOR_FORMAT,
  DEFAULT_OUTPUT_TERMINATOR,
  type ReadManyFilesLimits,
} from './read-many-files-content.js';
import {
  buildParameterSchema,
  formatExcludePatterns,
} from './read-many-files-schema.js';
import {
  createDefaultByteBudget,
  type ByteBudget,
} from '../acquisition/index.js';

type ProcessFilesResult = Readonly<{ totalTokens: number; error?: ToolResult }>;
type ProcessSingleFileResult = ProcessFilesResult & {
  readonly done: boolean;
  readonly totalBytes: number;
};

/**
 * Invocation-local finite discovery-record observation counter shared across
 * ALL workspace roots. Every path emitted by the glob stream is one observed
 * discovery record, charged BEFORE any filtering or deduplication — ignored
 * records, security-skipped records, and duplicates all consume the budget.
 * One-over semantics: exactly maxFileCount observed records is complete; the
 * maxFileCount+1-th record proves `truncated` and is not retained/stored.
 */
interface DiscoveryRecordTracker {
  observed: number;
  truncated: boolean;
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

// Default limits for ReadManyFiles
const DEFAULT_MAX_FILE_COUNT = 50;
const DEFAULT_MAX_TOKENS = 50000;
const DEFAULT_TRUNCATE_MODE = 'warn';
const DEFAULT_FILE_SIZE_LIMIT = 524288; // 512KB
/** Absolute ceiling on the number of files processed regardless of settings. */
const MAX_FILE_COUNT_HARD_CAP = 10_000;

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

    const limits = this.resolveLimits();
    const aggregateByteBudget = createDefaultByteBudget();

    const filesToConsider = new Set<string>();
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const processedFilesRelativePaths: string[] = [];
    const contentParts: Array<string | ContentPartUnion> = [];
    const discoveryRecords: DiscoveryRecordTracker = {
      observed: 0,
      truncated: false,
    };

    const searchResult = await this.discoverFiles(
      inputPatterns,
      include,
      effectiveExcludes,
      fileFilteringOptions,
      fileDiscovery,
      filesToConsider,
      skippedFiles,
      signal,
      limits.maxFileCount,
      discoveryRecords,
    );
    if (searchResult) {
      return searchResult;
    }

    const sortedFiles = Array.from(filesToConsider).sort();

    const fileCountResult = this.applyFileCountLimit(
      sortedFiles,
      skippedFiles,
      limits,
      discoveryRecords.truncated,
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
      aggregateByteBudget,
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
    contentParts: Array<string | ContentPartUnion>,
    limits: ReadManyFilesLimits,
    aggregateByteBudget: ByteBudget,
  ): Promise<ToolResult> {
    const processResult = await this.processFiles(
      sortedFiles,
      inputPatterns,
      skippedFiles,
      processedFilesRelativePaths,
      contentParts,
      limits,
      aggregateByteBudget,
    );
    if (processResult.error !== undefined) {
      return processResult.error;
    }

    const displayMessage = this.buildDisplayMessage(
      processedFilesRelativePaths,
      skippedFiles,
      processResult.totalTokens,
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
    maxFileCount: number,
    recordTracker: DiscoveryRecordTracker,
  ): Promise<ToolResult | undefined> {
    const searchPatterns = [...inputPatterns, ...include];
    try {
      const ignoredCounts = { git: 0, llxprt: 0 };

      for (const dir of this.host.getWorkspaceRoots()) {
        if (recordTracker.truncated) break;
        await this.collectDirectoryFiles(
          dir,
          searchPatterns,
          effectiveExcludes,
          fileFilteringOptions,
          fileDiscovery,
          filesToConsider,
          ignoredCounts,
          skippedFiles,
          signal,
          maxFileCount,
          recordTracker,
        );
      }

      this.recordDiscoverySkippedFiles(
        skippedFiles,
        ignoredCounts,
        recordTracker.truncated,
        maxFileCount,
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

  private async collectDirectoryFiles(
    dir: string,
    searchPatterns: string[],
    effectiveExcludes: string[],
    fileFilteringOptions: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
    },
    fileDiscovery: ReturnType<IToolHost['getFileService']>,
    filesToConsider: Set<string>,
    ignoredCounts: { git: number; llxprt: number },
    skippedFiles: Array<{ path: string; reason: string }>,
    signal: AbortSignal,
    maxFileCount: number,
    recordTracker: DiscoveryRecordTracker,
  ): Promise<void> {
    const processedPatterns = this.processSearchPatterns(dir, searchPatterns);
    const stream = globStream(processedPatterns, {
      cwd: dir,
      ignore: effectiveExcludes,
      nodir: true,
      dot: true,
      absolute: true,
      nocase: true,
      signal,
    });
    for await (const absoluteFilePath of stream) {
      // Charge every glob emission as ONE discovery record BEFORE any
      // filtering or dedup — ignored, security-skipped, duplicate, and
      // non-normalizable records all consume the shared invocation budget.
      // One-over semantics: exactly maxFileCount records is complete; the
      // maxFileCount+1-th record proves truncation and is NOT retained or
      // stored (no Set entry, skip metadata, or ignored count for it).
      recordTracker.observed++;
      if (recordTracker.observed > maxFileCount) {
        recordTracker.truncated = true;
        return;
      }
      const result = this.checkFileFilter(
        absoluteFilePath,
        fileFilteringOptions,
        fileDiscovery,
      );
      if (result.skipped) {
        if (result.type === 'security') {
          skippedFiles.push({
            path: absoluteFilePath,
            reason: result.reason ?? 'security',
          });
        }
        if (result.type === 'git') ignoredCounts.git++;
        if (result.type === 'llxprt') ignoredCounts.llxprt++;
        continue;
      }
      if (result.normalizedPath) {
        filesToConsider.add(result.normalizedPath);
      }
    }
  }

  private recordDiscoverySkippedFiles(
    skippedFiles: Array<{ path: string; reason: string }>,
    ignoredCounts: { git: number; llxprt: number },
    discoveryTruncated: boolean,
    maxFileCount: number,
  ): void {
    if (ignoredCounts.git > 0) {
      skippedFiles.push({
        path: `${ignoredCounts.git} file(s)`,
        reason: 'git ignored',
      });
    }
    if (ignoredCounts.llxprt > 0) {
      skippedFiles.push({
        path: `${ignoredCounts.llxprt} file(s)`,
        reason: 'llxprt ignored',
      });
    }
    if (discoveryTruncated) {
      skippedFiles.push({
        path: `discovery stopped at ${maxFileCount + 1} discovery record(s)`,
        reason: `discovery record limit (${maxFileCount}); more matching records may exist`,
      });
    }
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

  private resolveLimits(): ReadManyFilesLimits {
    const ephemeralSettings = this.host.getEphemeralSettings();
    const rawMaxItems = Number(
      (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
        DEFAULT_MAX_FILE_COUNT,
    );
    const maxFileCount =
      Number.isFinite(rawMaxItems) && rawMaxItems > 0
        ? Math.min(Math.floor(rawMaxItems), MAX_FILE_COUNT_HARD_CAP)
        : DEFAULT_MAX_FILE_COUNT;
    return {
      maxFileCount,
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
    limits: ReadManyFilesLimits,
    discoveryTruncated: boolean,
  ): ToolResult | undefined {
    const filesExceedCap = sortedFiles.length > limits.maxFileCount;
    if (!filesExceedCap) {
      if (discoveryTruncated && limits.truncateMode === 'warn')
        skippedFiles.push({
          path: `${limits.maxFileCount} discovery record limit`,
          reason: 'discovery truncated; some matching files may not be listed',
        });
      return undefined;
    }

    if (limits.truncateMode === 'warn') {
      // Discovery truncation is proven at the record level (one-over raw
      // glob emissions). The retained unique-file count alone understates
      // the traversal when records were skipped or deduplicated, so report
      // the truthful lower bound rather than implying a known file count.
      const warnMessage = `Found ${discoveryTruncated ? `more than ${limits.maxFileCount} matching discovery records` : `${sortedFiles.length} files matching your pattern`}, but limiting to ${limits.maxFileCount} files. Please use more specific patterns to narrow your search.`;
      return {
        llmContent: warnMessage,
        returnDisplay: `## File Count Limit Exceeded\n\n${warnMessage}\n\n**Matched files:** ${discoveryTruncated ? `more than ${limits.maxFileCount}` : sortedFiles.length}\n**Limit:** ${limits.maxFileCount}\n\n**Suggestion:** Use more specific glob patterns or paths to reduce the number of matched files.`,
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
    contentParts: Array<string | ContentPartUnion>,
    limits: ReadManyFilesLimits,
    aggregateByteBudget: ByteBudget,
  ): Promise<ProcessFilesResult> {
    const ephemeralSettings = this.host.getEphemeralSettings();
    // Resolve both image policies once from one settings snapshot inside one
    // guard so malformed settings surface as structured tool errors.
    let imageResizePolicy: ImageResizePolicy | undefined;
    let imageBudget: ImageDimensionBudget | undefined;
    try {
      imageResizePolicy = resolveImageResizePolicy(ephemeralSettings);
      imageBudget = resolveImageDimensionBudget(ephemeralSettings);
    } catch (error) {
      return createImageConfigurationToolResult(
        getErrorMessage(error),
        ToolErrorType.READ_CONTENT_FAILURE,
        0,
      );
    }
    const maxLinesPerFile =
      (ephemeralSettings['file-read-max-lines'] as number | undefined) ??
      DEFAULT_MAX_LINES_TEXT_FILE;
    let totalTokens = 0;
    // Pre-charge the output terminator bytes so every content path (ordinary,
    // warn, truncate, overflow) accounts for it and the final complete output
    // can never exceed the aggregate acquisition byte budget.
    let totalBytes = Buffer.byteLength(DEFAULT_OUTPUT_TERMINATOR, 'utf8');
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
        totalBytes,
        aggregateByteBudget,
        imageResizePolicy,
        imageBudget,
        maxLinesPerFile,
      );
      if (result.error !== undefined || result.done) {
        return result;
      }
      totalTokens = result.totalTokens;
      totalBytes = result.totalBytes;
    }
    return { totalTokens };
  }

  private async processSingleFile(
    filePath: string,
    sortedFiles: string[],
    inputPatterns: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    processedFilesRelativePaths: string[],
    contentParts: Array<string | ContentPartUnion>,
    limits: ReadManyFilesLimits,
    currentTokens: number,
    currentBytes: number,
    aggregateByteBudget: ByteBudget,
    imageResizePolicy: ImageResizePolicy | undefined,
    imageBudget: ImageDimensionBudget | undefined,
    maxLinesPerFile: number,
  ): Promise<ProcessSingleFileResult> {
    const relativePathForDisplay = path
      .relative(this.host.getTargetDir(), filePath)
      .replace(/\\/g, '/');
    const gate = await runPreReadGates(
      filePath,
      inputPatterns,
      relativePathForDisplay,
      skippedFiles,
      limits.fileSizeLimit,
      currentTokens,
      imageBudget,
      imageResizePolicy !== undefined,
    );
    if (gate.outcome === 'preflight-error') {
      return { ...gate.result, totalBytes: currentBytes };
    }
    if (gate.outcome === 'skip') {
      return {
        done: false,
        totalTokens: currentTokens,
        totalBytes: currentBytes,
      };
    }

    return this.assembleFileContent(
      filePath,
      relativePathForDisplay,
      gate.resizeBeforeOutputLimit,
      sortedFiles,
      skippedFiles,
      processedFilesRelativePaths,
      contentParts,
      limits,
      currentTokens,
      currentBytes,
      aggregateByteBudget,
      imageResizePolicy,
      imageBudget,
      maxLinesPerFile,
    );
  }

  private async assembleFileContent(
    filePath: string,
    relativePathForDisplay: string,
    resizeBeforeOutputLimit: boolean,
    sortedFiles: string[],
    skippedFiles: Array<{ path: string; reason: string }>,
    processedFilesRelativePaths: string[],
    contentParts: Array<string | ContentPartUnion>,
    limits: ReadManyFilesLimits,
    currentTokens: number,
    currentBytes: number,
    aggregateByteBudget: ByteBudget,
    imageResizePolicy: ImageResizePolicy | undefined,
    imageBudget: ImageDimensionBudget | undefined,
    maxLinesPerFile: number,
  ): Promise<ProcessSingleFileResult> {
    const fileReadResult = await processSingleFileContent(
      filePath,
      this.host.getTargetDir(),
      undefined,
      maxLinesPerFile,
      imageResizePolicy,
      imageBudget,
    );
    const imageError =
      getImageResizeToolResult(fileReadResult, currentTokens) ??
      getImageBudgetToolResult(fileReadResult, currentTokens);
    if (imageError !== undefined) {
      return { ...imageError, totalBytes: currentBytes };
    }
    const skipReason = getProcessedFileSkipReason(
      fileReadResult,
      resizeBeforeOutputLimit,
      limits.fileSizeLimit,
    );
    if (skipReason !== undefined) {
      skippedFiles.push({ path: relativePathForDisplay, reason: skipReason });
      return {
        done: false,
        totalTokens: currentTokens,
        totalBytes: currentBytes,
      };
    }

    const addResult = addFileContent(
      fileReadResult,
      filePath,
      relativePathForDisplay,
      skippedFiles,
      contentParts,
      limits,
      currentTokens,
      currentBytes,
      aggregateByteBudget,
      sortedFiles,
      processedFilesRelativePaths,
    );

    if (addResult.action === 'stop') {
      return {
        done: true,
        totalTokens: addResult.totalTokens,
        totalBytes: addResult.totalBytes,
      };
    }

    processedFilesRelativePaths.push(relativePathForDisplay);
    this.recordReadMetric(filePath, fileReadResult.llmContent);
    if (addResult.action === 'stopAfterRecord') {
      return {
        done: true,
        totalTokens: addResult.totalTokens,
        totalBytes: addResult.totalBytes,
      };
    }
    return {
      done: false,
      totalTokens: addResult.totalTokens,
      totalBytes: addResult.totalBytes,
    };
  }

  private recordReadMetric(
    filePath: string,
    llmContent: string | ContentPartUnion,
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
