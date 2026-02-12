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
import { getErrorMessage } from '../utils/errors.js';
import * as fs from 'fs';
import * as path from 'path';
import { glob, escape } from 'glob';
import { getCurrentLlxprtMdFilename } from './memoryTool.js';
import {
  detectFileType,
  processSingleFileContent,
  DEFAULT_ENCODING,
  getSpecificMimeType,
  DEFAULT_MAX_LINES_TEXT_FILE,
} from '../utils/fileUtils.js';
import { type PartListUnion } from '@google/genai';
import { Config, DEFAULT_FILE_FILTERING_OPTIONS } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';
import { stat } from 'fs/promises';
import { ToolErrorType } from './tool-error.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';

// Simple token estimation - roughly 4 characters per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
 * TODO(adh): Consider making this configurable or extendable through a command line argument.
 */
function getDefaultExcludes(config?: Config): string[] {
  const baseExcludes =
    config?.getFileExclusions().getReadManyFilesExcludes() ?? [];
  return [...baseExcludes, `**/${getCurrentLlxprtMdFilename()}`];
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
  private readonly llxprtIgnorePatterns: string[] = [];

  constructor(
    private readonly config: Config,
    params: ReadManyFilesParams,
  ) {
    super(params);
    this.llxprtIgnorePatterns = config
      .getFileService()
      .getLlxprtIgnorePatterns();
  }

  getDescription(): string {
    const allPatterns = [...this.params.paths, ...(this.params.include || [])];
    const pathDesc = `using patterns: 
${allPatterns.join('`, `')}
 (within target directory: 
${this.config.getTargetDir()}
) `;

    // Determine the final list of exclusion patterns exactly as in execute method
    const paramExcludes = this.params.exclude || [];
    const paramUseDefaultExcludes = this.params.useDefaultExcludes !== false;
    const finalExclusionPatternsForDescription: string[] =
      paramUseDefaultExcludes
        ? [...getDefaultExcludes(this.config), ...paramExcludes]
        : [...paramExcludes];

    const excludeDesc = `Excluding: ${
      finalExclusionPatternsForDescription.length > 0
        ? `patterns like 
${finalExclusionPatternsForDescription
  .slice(0, 2)
  .join(
    '`, `',
  )}${finalExclusionPatternsForDescription.length > 2 ? '...`' : '`'}`
        : 'none specified'
    }`;

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

    const defaultFileIgnores =
      this.config.getFileFilteringOptions() ?? DEFAULT_FILE_FILTERING_OPTIONS;

    const fileFilteringOptions = {
      respectGitIgnore:
        this.params.file_filtering_options?.respect_git_ignore ??
        defaultFileIgnores.respectGitIgnore, // Use the property from the returned object
      respectLlxprtIgnore:
        this.params.file_filtering_options?.respect_llxprt_ignore ??
        defaultFileIgnores.respectLlxprtIgnore, // Use the property from the returned object
    };
    // Get centralized file discovery service
    const fileDiscovery = this.config.getFileService();

    const filesToConsider = new Set<string>();
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const processedFilesRelativePaths: string[] = [];
    const contentParts: PartListUnion = [];

    const effectiveExcludes = useDefaultExcludes
      ? [
          ...getDefaultExcludes(this.config),
          ...exclude,
          ...this.llxprtIgnorePatterns,
        ]
      : [...exclude, ...this.llxprtIgnorePatterns];

    const searchPatterns = [...inputPatterns, ...include];
    try {
      const allEntries = new Set<string>();
      const workspaceDirs = this.config.getWorkspaceContext().getDirectories();

      for (const dir of workspaceDirs) {
        const processedPatterns = [];
        for (const p of searchPatterns) {
          const normalizedP = p.replace(/\\/g, '/');
          const fullPath = path.join(dir, normalizedP);
          if (fs.existsSync(fullPath)) {
            processedPatterns.push(escape(normalizedP));
          } else {
            // The path does not exist or is not a file, so we treat it as a glob pattern.
            processedPatterns.push(normalizedP);
          }
        }

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
      const entries = Array.from(allEntries);

      let gitIgnoredCount = 0;
      let llxprtIgnoredCount = 0;

      for (const absoluteFilePath of entries) {
        // Security check: ensure the glob library didn't return something outside the workspace.
        if (
          !this.config
            .getWorkspaceContext()
            .isPathWithinWorkspace(absoluteFilePath)
        ) {
          skippedFiles.push({
            path: absoluteFilePath,
            reason: `Security: Glob library returned path outside workspace. Path: ${absoluteFilePath}`,
          });
          continue;
        }

        const normalizedPath = path.normalize(absoluteFilePath);

        if (
          fileFilteringOptions.respectGitIgnore &&
          fileDiscovery.shouldIgnoreFile(absoluteFilePath, {
            respectGitIgnore: true,
            respectLlxprtIgnore: false,
          })
        ) {
          gitIgnoredCount++;
          continue;
        }

        if (
          fileFilteringOptions.respectLlxprtIgnore &&
          fileDiscovery.shouldIgnoreFile(absoluteFilePath, {
            respectGitIgnore: false,
            respectLlxprtIgnore: true,
          })
        ) {
          llxprtIgnoredCount++;
          continue;
        }

        filesToConsider.add(normalizedPath);
      }

      // Add info about git-ignored files if any were filtered
      if (gitIgnoredCount > 0) {
        skippedFiles.push({
          path: `${gitIgnoredCount} file(s)`,
          reason: 'git ignored',
        });
      }

      // Add info about llxprt-ignored files if any were filtered
      if (llxprtIgnoredCount > 0) {
        skippedFiles.push({
          path: `${llxprtIgnoredCount} file(s)`,
          reason: 'llxprt ignored',
        });
      }
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

    const sortedFiles = Array.from(filesToConsider).sort();

    // Get limits from ephemeral settings
    const ephemeralSettings = this.config.getEphemeralSettings();
    const maxFileCount =
      (ephemeralSettings['tool-output-max-items'] as number | undefined) ??
      DEFAULT_MAX_FILE_COUNT;
    const maxTokens =
      (ephemeralSettings['tool-output-max-tokens'] as number | undefined) ??
      DEFAULT_MAX_TOKENS;
    const truncateMode =
      (ephemeralSettings['tool-output-truncate-mode'] as
        | 'warn'
        | 'truncate'
        | 'sample'
        | undefined) ?? DEFAULT_TRUNCATE_MODE;
    const fileSizeLimit =
      (ephemeralSettings['tool-output-item-size-limit'] as
        | number
        | undefined) ?? DEFAULT_FILE_SIZE_LIMIT;

    // Check file count limit
    if (sortedFiles.length > maxFileCount) {
      if (truncateMode === 'warn') {
        const warnMessage = `Found ${sortedFiles.length} files matching your pattern, but limiting to ${maxFileCount} files. Please use more specific patterns to narrow your search.`;
        return {
          llmContent: warnMessage,
          returnDisplay: `## File Count Limit Exceeded\n\n${warnMessage}\n\n**Matched files:** ${sortedFiles.length}\n**Limit:** ${maxFileCount}\n\n**Suggestion:** Use more specific glob patterns or paths to reduce the number of matched files.`,
        };
      } else if (truncateMode === 'sample') {
        // Sample evenly across the files
        const step = Math.ceil(sortedFiles.length / maxFileCount);
        const sampledFiles: string[] = [];
        for (let i = 0; i < sortedFiles.length; i += step) {
          if (sampledFiles.length < maxFileCount) {
            sampledFiles.push(sortedFiles[i]);
          }
        }
        const originalCount = sortedFiles.length;
        sortedFiles.length = 0;
        sortedFiles.push(...sampledFiles);
        skippedFiles.push({
          path: `${originalCount - sampledFiles.length} file(s)`,
          reason: `sampling to stay within ${maxFileCount} file limit`,
        });
      } else {
        // truncate mode - just limit the array
        const truncatedCount = sortedFiles.length - maxFileCount;
        sortedFiles.length = maxFileCount;
        skippedFiles.push({
          path: `${truncatedCount} file(s)`,
          reason: `truncated to stay within ${maxFileCount} file limit`,
        });
      }
    }

    let totalTokens = 0;

    for (const filePath of sortedFiles) {
      const relativePathForDisplay = path
        .relative(this.config.getTargetDir(), filePath)
        .replace(/\\/g, '/');

      // Check file size limit
      try {
        const stats = await stat(filePath);
        if (stats.size > fileSizeLimit) {
          skippedFiles.push({
            path: relativePathForDisplay,
            reason: `file size (${Math.round(stats.size / 1024)}KB) exceeds limit (${Math.round(fileSizeLimit / 1024)}KB)`,
          });
          continue;
        }
      } catch (error) {
        skippedFiles.push({
          path: relativePathForDisplay,
          reason: `stat error: ${getErrorMessage(error)}`,
        });
        continue;
      }

      const fileType = await detectFileType(filePath);

      if (fileType === 'image' || fileType === 'pdf') {
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
              'asset file (image/pdf) was not explicitly requested by name or extension',
          });
          continue;
        }
      }

      // Use processSingleFileContent for all file types now
      const ephemeralSettings = this.config.getEphemeralSettings();
      const maxLinesPerFile =
        (ephemeralSettings['file-read-max-lines'] as number | undefined) ??
        DEFAULT_MAX_LINES_TEXT_FILE;

      const fileReadResult = await processSingleFileContent(
        filePath,
        this.config.getTargetDir(),
        this.config.getFileSystemService(),
        undefined,
        maxLinesPerFile,
      );

      if (fileReadResult.error) {
        skippedFiles.push({
          path: relativePathForDisplay,
          reason: `Read error: ${fileReadResult.error}`,
        });
      } else {
        // Check token limit before adding content
        if (typeof fileReadResult.llmContent === 'string') {
          const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace(
            '{filePath}',
            filePath,
          );
          let fileContentForLlm = '';
          if (fileReadResult.isTruncated) {
            fileContentForLlm += `[WARNING: This file was truncated. To view the full content, use the 'read_file' tool on this specific file.]\n\n`;
          }
          fileContentForLlm += fileReadResult.llmContent;
          const contentToAdd = `${separator}\n\n${fileContentForLlm}\n\n`;
          const contentTokens = estimateTokens(contentToAdd);

          if (totalTokens + contentTokens > maxTokens) {
            if (truncateMode === 'warn') {
              // Stop processing and warn
              skippedFiles.push({
                path: `${sortedFiles.length - processedFilesRelativePaths.length} remaining file(s)`,
                reason: `would exceed token limit of ${maxTokens}`,
              });
              break;
            } else if (truncateMode === 'truncate') {
              // Truncate the content to fit
              const remainingTokens = maxTokens - totalTokens;
              if (remainingTokens > 100) {
                // Only add if we have reasonable space
                const truncatedContent = contentToAdd.substring(
                  0,
                  remainingTokens * 4,
                ); // Rough estimate: 4 chars per token
                contentParts.push(
                  truncatedContent +
                    '\n\n[CONTENT TRUNCATED DUE TO TOKEN LIMIT]',
                );
                processedFilesRelativePaths.push(relativePathForDisplay);
                skippedFiles.push({
                  path: relativePathForDisplay,
                  reason: 'content truncated to fit token limit',
                });
              }
              break;
            } else {
              // sample mode - skip this file and continue
              skippedFiles.push({
                path: relativePathForDisplay,
                reason: 'skipped to stay within token limit',
              });
              continue;
            }
          }

          totalTokens += contentTokens;
          contentParts.push(contentToAdd);
        } else {
          // For non-text content (images/PDFs), estimate token usage
          // Images typically use ~85 tokens per image
          const estimatedTokens = 85;
          if (totalTokens + estimatedTokens > maxTokens) {
            skippedFiles.push({
              path: relativePathForDisplay,
              reason: 'would exceed token limit (non-text content)',
            });
            continue;
          }
          totalTokens += estimatedTokens;
          // This is a Part for image/pdf, which we don't add the separator to.
          contentParts.push(fileReadResult.llmContent);
        }
        processedFilesRelativePaths.push(relativePathForDisplay);
        const lines =
          typeof fileReadResult.llmContent === 'string'
            ? fileReadResult.llmContent.split('\n').length
            : undefined;
        const mimetype = getSpecificMimeType(filePath);
        recordFileOperationMetric(
          this.config,
          FileOperation.READ,
          lines,
          mimetype,
          path.extname(filePath),
        );
      }
    }

    let displayMessage = `### ReadManyFiles Result (Target Dir: \`${this.config.getTargetDir()}\`)\n\n`;
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

  constructor(
    private config: Config,
    _messageBus?: MessageBus,
  ) {
    const parameterSchema = {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
          minItems: 1,
          description:
            "Required. An array of glob patterns or paths relative to the tool's target directory. Examples: ['src/**/*.ts'], ['README.md', 'docs/']",
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
          description:
            'Optional. Additional glob patterns to include. These are merged with `paths`. Example: "*.test.ts" to specifically add test files if they were broadly excluded.',
          default: [],
        },
        exclude: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
          description:
            'Optional. Glob patterns for files/directories to exclude. Added to default excludes if useDefaultExcludes is true. Example: "**/*.log", "temp/"',
          default: [],
        },
        recursive: {
          type: 'boolean',
          description:
            'Optional. Whether to search recursively (primarily controlled by `**` in glob patterns). Defaults to true.',
          default: true,
        },
        useDefaultExcludes: {
          type: 'boolean',
          description:
            'Optional. Whether to apply a list of default exclusion patterns (e.g., node_modules, .git, binary files). Defaults to true.',
          default: true,
        },
        file_filtering_options: {
          description:
            'Whether to respect ignore patterns from .gitignore or .llxprtignore',
          type: 'object',
          properties: {
            respect_git_ignore: {
              description:
                'Optional: Whether to respect .gitignore patterns when listing files. Only available in git repositories. Defaults to true.',
              type: 'boolean',
            },
            respect_llxprt_ignore: {
              description:
                'Optional: Whether to respect .llxprtignore patterns when listing files. Defaults to true.',
              type: 'boolean',
            },
          },
        },
      },
      required: ['paths'],
    };

    super(
      ReadManyFilesTool.Name,
      'ReadManyFiles',
      `Reads content from multiple files specified by paths or glob patterns within a configured target directory. For text files, it concatenates their content into a single string. It is primarily designed for text-based files. However, it can also process image (e.g., .png, .jpg) and PDF (.pdf) files if their file names or extensions are explicitly included in the 'paths' argument. For these explicitly requested non-text files, their data is read and included in a format suitable for model consumption (e.g., base64 encoded).

This tool is useful when you need to understand or analyze a collection of files, such as:
- Getting an overview of a codebase or parts of it (e.g., all TypeScript files in the 'src' directory).
- Finding where specific functionality is implemented if the user asks broad questions about code.
- Reviewing documentation files (e.g., all Markdown files in the 'docs' directory).
- Gathering context from multiple configuration files.
- When the user asks to "read all files in X directory" or "show me the content of all Y files".

Use this tool when the user's query implies needing the content of several files simultaneously for context, analysis, or summarization. For text files, it uses default UTF-8 encoding and a '--- {filePath} ---' separator between file contents. The tool inserts a '--- End of content ---' after the last file. Ensure paths are relative to the target directory. Glob patterns like 'src/**/*.js' are supported. Avoid using for single files if a more specific single-file reading tool is available, unless the user specifically requests to process a list containing just one file via this tool. Other binary files (not explicitly requested as image/PDF) are generally skipped. Default excludes apply to common non-text files (except for explicitly requested images/PDFs) and large dependency directories unless 'useDefaultExcludes' is false.

IMPORTANT LIMITS:
- Maximum files: 50 (default, configurable via 'tool-output-max-items' setting)
- Maximum tokens: 50,000 (default, configurable via 'tool-output-max-tokens' setting)  
- Maximum file size: 512KB per file (configurable via 'tool-output-item-size-limit' setting)
- If limits are exceeded, the tool will warn and suggest more specific patterns (configurable behavior via 'tool-output-truncate-mode')`,
      Kind.Read,
      parameterSchema,
    );
  }

  protected override createInvocation(
    params: ReadManyFilesParams,
    _messageBus?: MessageBus,
  ): ToolInvocation<ReadManyFilesParams, ToolResult> {
    return new ReadManyFilesToolInvocation(this.config, params);
  }
}
