/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { makeRelative, shortenPath } from '../utils/paths.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
} from './tools.js';

import { type PartUnion } from '@google/genai';
import {
  processSingleFileContent,
  getSpecificMimeType,
} from '../utils/fileUtils.js';
import { Config } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';

/**
 * Parameters for the ReadFile tool
 */
export interface ReadFileToolParams {
  /**
   * The absolute path to the file to read
   */
  absolute_path?: string;

  /**
   * Alternative parameter name for absolute_path (for compatibility)
   * Not shown in schema - internal use only
   */
  file_path?: string;

  /**
   * The line number to start reading from (optional)
   */
  offset?: number;

  /**
   * The number of lines to read (optional)
   */
  limit?: number;

  /**
   * When true, prefixes each text line with a virtual line number.
   */
  showLineNumbers?: boolean;
}

function formatWithLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const maxLine = startLine + lines.length - 1;
  const width = Math.max(4, String(maxLine).length);
  return lines
    .map((line, index) => {
      const lineNo = startLine + index;
      const padded = String(lineNo).padStart(width, ' ');
      return `${padded}| ${line}`;
    })
    .join('\n');
}

class ReadFileToolInvocation extends BaseToolInvocation<
  ReadFileToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: ReadFileToolParams,
  ) {
    super(params);
  }

  private getFilePath(): string {
    // Use absolute_path if provided, otherwise fall back to file_path
    return this.params.absolute_path || this.params.file_path || '';
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.getFilePath(),
      this.config.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath(), line: this.params.offset }];
  }

  async execute(): Promise<ToolResult> {
    const result = await processSingleFileContent(
      this.getFilePath(),
      this.config.getTargetDir(),
      this.config.getFileSystemService(),
      this.params.offset,
      this.params.limit,
    );

    if (result.error) {
      return {
        llmContent: result.llmContent,
        returnDisplay: result.returnDisplay || 'Error reading file',
        error: {
          message: result.error,
          type: result.errorType,
        },
      };
    }

    let llmContent: PartUnion;

    if (typeof result.llmContent !== 'string') {
      llmContent = result.llmContent;
    } else if (result.isTruncated) {
      const [start, end] = result.linesShown!;
      const total = result.originalLineCount!;
      const nextOffset = this.params.offset
        ? this.params.offset + end - start + 1
        : end;

      const startLine = this.params.offset ? this.params.offset + 1 : start;
      const numberedContent = this.params.showLineNumbers
        ? formatWithLineNumbers(result.llmContent, startLine)
        : result.llmContent;

      llmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines ${start}-${end} of ${total} total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: ${nextOffset}.

--- FILE CONTENT (truncated) ---
${numberedContent}`;
    } else {
      const startLine = this.params.offset ? this.params.offset + 1 : 1;
      llmContent = this.params.showLineNumbers
        ? formatWithLineNumbers(result.llmContent, startLine)
        : result.llmContent;
    }

    const lines =
      typeof result.llmContent === 'string'
        ? result.llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(this.getFilePath());
    recordFileOperationMetric(
      this.config,
      FileOperation.READ,
      lines,
      mimetype,
      path.extname(this.getFilePath()),
    );

    return {
      llmContent,
      returnDisplay: result.returnDisplay || '',
    };
  }
}

/**
 * Implementation of the ReadFile tool logic
 */
export class ReadFileTool extends BaseDeclarativeTool<
  ReadFileToolParams,
  ToolResult
> {
  static readonly Name: string = 'read_file';

  constructor(
    private config: Config,
    _messageBus?: MessageBus,
  ) {
    super(
      ReadFileTool.Name,
      'ReadFile',
      `Reads and returns the content of a specified file. If the file is large, the content will be truncated. The tool's response will clearly indicate if truncation has occurred and will provide details on how to read more of the file using the 'offset' and 'limit' parameters. Handles text, images (PNG, JPG, GIF, WEBP, SVG, BMP), and PDF files. For text files, it can read specific line ranges.`,
      Kind.Read,
      {
        properties: {
          absolute_path: {
            description:
              "The absolute path to the file to read (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path.",
            type: 'string',
          },
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file to read.',
            type: 'string',
          },
          offset: {
            description:
              "Optional: For text files, the 0-based line number to start reading from. Requires 'limit' to be set. Use for paginating through large files.",
            type: 'number',
          },
          limit: {
            description:
              "Optional: For text files, maximum number of lines to read. Use with 'offset' to paginate through large files. If omitted, reads the entire file (if feasible, up to a default limit).",
            type: 'number',
          },
          showLineNumbers: {
            description:
              'Optional: When true, prefixes each line of the returned text with a left-padded virtual line number and a separator bar (for example, " 294| const x = 1;"). This numbering is not part of the underlying file; it is only a visual aid. Recommended when you need to precisely understand line numbers in large files for subsequent editing operations.',
            type: 'boolean',
          },
        },
        // Don't require either in schema - validation handles this
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: ReadFileToolParams,
  ): string | null {
    // Accept either absolute_path or file_path
    const filePath = params.absolute_path || params.file_path || '';

    if (filePath.trim() === '') {
      return "Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.";
    }

    if (!path.isAbsolute(filePath)) {
      return `File path must be absolute, but was relative: ${filePath}. You must provide an absolute path.`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(filePath)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }
    if (params.offset !== undefined && params.offset < 0) {
      return 'Offset must be a non-negative number';
    }
    if (params.limit !== undefined && params.limit <= 0) {
      return 'Limit must be a positive number';
    }

    const fileService = this.config.getFileService();
    if (fileService.shouldLlxprtIgnoreFile(filePath)) {
      return `File path '${filePath}' is ignored by .llxprtignore pattern(s).`;
    }

    return null;
  }

  protected override createInvocation(
    params: ReadFileToolParams,
    _messageBus?: MessageBus,
  ): ToolInvocation<ReadFileToolParams, ToolResult> {
    // Normalize parameters: if file_path is provided but not absolute_path, copy it over
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new ReadFileToolInvocation(this.config, normalizedParams);
  }
}
