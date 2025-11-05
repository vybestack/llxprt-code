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
import { ToolErrorType } from './tool-error.js';

import { Config } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';
import { getSpecificMimeType } from '../utils/fileUtils.js';

/**
 * Parameters for the DeleteLineRange tool
 */
export interface DeleteLineRangeToolParams {
  /**
   * The absolute path to the file to modify
   */
  absolute_path: string;

  /**
   * The 1-based line number to start deleting from (inclusive)
   */
  start_line: number;

  /**
   * The 1-based line number to end deleting at (inclusive)
   */
  end_line: number;
}

class DeleteLineRangeToolInvocation extends BaseToolInvocation<
  DeleteLineRangeToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: DeleteLineRangeToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.absolute_path,
      this.config.getTargetDir(),
    );
    return `Delete lines ${this.params.start_line}-${this.params.end_line} from ${shortenPath(relativePath)}`;
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.params.absolute_path, line: this.params.start_line }];
  }

  async execute(): Promise<ToolResult> {
    const fileService = this.config.getFileSystemService();

    // Read the file content
    let content: string;
    try {
      content = await fileService.readTextFile(this.params.absolute_path);
    } catch (error) {
      return {
        llmContent: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        returnDisplay: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: ToolErrorType.FILE_NOT_FOUND,
        },
      };
    }

    // Split into lines
    const lines = content.split('\n');

    // Validate line numbers
    const totalLines = lines.length;
    if (this.params.start_line > totalLines) {
      return {
        llmContent: `Cannot delete lines: start_line ${this.params.start_line} is beyond the total number of lines (${totalLines})`,
        returnDisplay: `Cannot delete lines: start_line ${this.params.start_line} is beyond the total number of lines (${totalLines})`,
        error: {
          message: `start_line ${this.params.start_line} exceeds file length (${totalLines})`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Calculate 0-based indices
    const startIndex = this.params.start_line - 1;
    const count = this.params.end_line - this.params.start_line + 1;

    // Remove the lines
    lines.splice(startIndex, count);

    // Join back
    const newContent = lines.join('\n');

    // Write back
    try {
      await fileService.writeTextFile(this.params.absolute_path, newContent);

      // Record metrics
      const linesDeleted = count;
      const mimetype = getSpecificMimeType(this.params.absolute_path);
      recordFileOperationMetric(
        this.config,
        FileOperation.UPDATE,
        linesDeleted,
        mimetype,
        path.extname(this.params.absolute_path),
      );

      return {
        llmContent: `Successfully deleted lines ${this.params.start_line}-${this.params.end_line} from ${this.params.absolute_path}`,
        returnDisplay: `Deleted ${count} lines (${this.params.start_line}-${this.params.end_line})`,
      };
    } catch (error) {
      return {
        llmContent: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        returnDisplay: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }
}

/**
 * Implementation of the DeleteLineRange tool logic
 */
export class DeleteLineRangeTool extends BaseDeclarativeTool<
  DeleteLineRangeToolParams,
  ToolResult
> {
  static readonly Name: string = 'delete_line_range';

  constructor(private config: Config) {
    super(
      DeleteLineRangeTool.Name,
      'DeleteLineRange',
      `Deletes a specific range of lines from a file. This is the preferred way to delete large blocks, as it avoids using a massive, brittle 'old_string' in the 'replace' tool. Always read the file or use 'get_file_outline' first to get the exact line numbers before deleting.`,
      Kind.Edit,
      {
        properties: {
          absolute_path: {
            description:
              "The absolute path to the file to modify. Must start with '/' and be within the workspace.",
            type: 'string',
          },
          start_line: {
            description:
              'The 1-based line number to start deleting from (inclusive).',
            type: 'number',
            minimum: 1,
          },
          end_line: {
            description:
              'The 1-based line number to end deleting at (inclusive). Must be >= start_line.',
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
    params: DeleteLineRangeToolParams,
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
    params: DeleteLineRangeToolParams,
  ): ToolInvocation<DeleteLineRangeToolParams, ToolResult> {
    return new DeleteLineRangeToolInvocation(this.config, params);
  }
}
