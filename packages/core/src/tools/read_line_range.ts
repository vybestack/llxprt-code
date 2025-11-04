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
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from './tools.js';

import { PartUnion } from '@google/genai';
import {
  processSingleFileContent,
  getSpecificMimeType,
} from '../utils/fileUtils.js';
import { Config } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';

/**
 * Parameters for the ReadLineRange tool
 */
export interface ReadLineRangeToolParams {
  /**
   * The absolute path to the file to read
   */
  absolute_path: string;

  /**
   * The 1-based line number to start reading from (inclusive)
   */
  start_line: number;

  /**
   * The 1-based line number to end reading at (inclusive)
   */
  end_line: number;
}

class ReadLineRangeToolInvocation extends BaseToolInvocation<
  ReadLineRangeToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: ReadLineRangeToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.absolute_path,
      this.config.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.params.absolute_path, line: this.params.start_line }];
  }

  async execute(): Promise<ToolResult> {
    // Convert 1-based line numbers to 0-based offset and limit
    const offset = this.params.start_line - 1;
    const limit = this.params.end_line - this.params.start_line + 1;

    const result = await processSingleFileContent(
      this.params.absolute_path,
      this.config.getTargetDir(),
      this.config.getFileSystemService(),
      offset,
      limit,
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
    if (result.isTruncated) {
      const [start, end] = result.linesShown!;
      const total = result.originalLineCount!;
      llmContent = `\nIMPORTANT: The file content has been truncated.\nStatus: Showing lines ${start}-${end} of ${total} total lines.\nAction: To read more of the file, you can use the 'read_file' tool with 'offset' and 'limit' parameters.\n\n--- FILE CONTENT (truncated) ---\n${result.llmContent}`;
    } else {
      llmContent = result.llmContent || '';
    }

    const lines =
      typeof result.llmContent === 'string'
        ? result.llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(this.params.absolute_path);
    recordFileOperationMetric(
      this.config,
      FileOperation.READ,
      lines,
      mimetype,
      path.extname(this.params.absolute_path),
    );

    return {
      llmContent,
      returnDisplay: result.returnDisplay || '',
    };
  }
}

/**
 * Implementation of the ReadLineRange tool logic
 */
export class ReadLineRangeTool extends BaseDeclarativeTool<
  ReadLineRangeToolParams,
  ToolResult
> {
  static readonly Name: string = 'read_line_range';

  constructor(private config: Config) {
    super(
      ReadLineRangeTool.Name,
      'ReadLineRange',
      `Reads a specific range of lines from a file. This is very useful for "copying" a function or class after finding its definition. The 'start_line' and 'end_line' parameters are 1-based and inclusive.`,
      Kind.Read,
      {
        properties: {
          absolute_path: {
            description:
              "The absolute path to the file to read (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path.",
            type: 'string',
          },
          start_line: {
            description:
              'The 1-based line number to start reading from (inclusive).',
            type: 'number',
            minimum: 1,
          },
          end_line: {
            description:
              'The 1-based line number to end reading at (inclusive). Must be >= start_line.',
            type: 'number',
            minimum: 1,
          },
        },
        required: ['absolute_path', 'start_line', 'end_line'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: ReadLineRangeToolParams,
  ): string | null {
    if (!params.absolute_path || params.absolute_path.trim() === '') {
      return "The 'absolute_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(params.absolute_path)) {
      return `File path must be absolute: ${params.absolute_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(params.absolute_path)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    if (params.start_line < 1) {
      return 'start_line must be a positive integer (>= 1)';
    }

    if (params.end_line < 1) {
      return 'end_line must be a positive integer (>= 1)';
    }

    if (params.end_line < params.start_line) {
      return 'end_line must be greater than or equal to start_line';
    }

    const fileService = this.config.getFileService();
    if (fileService.shouldLlxprtIgnoreFile(params.absolute_path)) {
      return `File path '${params.absolute_path}' is ignored by .llxprtignore pattern(s).`;
    }

    return null;
  }

  protected createInvocation(
    params: ReadLineRangeToolParams,
  ): ToolInvocation<ReadLineRangeToolParams, ToolResult> {
    return new ReadLineRangeToolInvocation(this.config, params);
  }
}
