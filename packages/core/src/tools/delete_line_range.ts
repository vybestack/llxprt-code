/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import * as Diff from 'diff';
import { makeRelative, shortenPath } from '../utils/paths.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
  type ToolCallConfirmationDetails,
  type ToolEditConfirmationDetails,
  ToolConfirmationOutcome,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';

import { Config, ApprovalMode } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';
import { getSpecificMimeType } from '../utils/fileUtils.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from './diffOptions.js';
import { IDEConnectionStatus } from '../ide/ide-client.js';

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

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const approvalMode = this.config.getApprovalMode();
    if (
      approvalMode === ApprovalMode.AUTO_EDIT ||
      approvalMode === ApprovalMode.YOLO
    ) {
      return false;
    }

    const fileService = this.config.getFileSystemService();

    let originalContent: string;
    try {
      originalContent = await fileService.readTextFile(
        this.params.absolute_path,
      );
    } catch {
      return false;
    }

    const lines = originalContent.split('\n');
    const totalLines = lines.length;
    if (this.params.start_line > totalLines) {
      return false;
    }

    const startIndex = this.params.start_line - 1;
    const count = this.params.end_line - this.params.start_line + 1;
    const newLines = [...lines];
    newLines.splice(startIndex, count);
    const newContent = newLines.join('\n');

    const relativePath = makeRelative(
      this.params.absolute_path,
      this.config.getTargetDir(),
    );
    const fileName = path.basename(this.params.absolute_path);

    const fileDiff = Diff.createPatch(
      fileName,
      originalContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    ) as string;

    const ideClient = this.config.getIdeClient();
    const ideConfirmation =
      this.config.getIdeMode() &&
      ideClient &&
      ideClient.getConnectionStatus().status === IDEConnectionStatus.Connected
        ? ideClient.openDiff(this.params.absolute_path, newContent)
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Delete: ${shortenPath(relativePath)} (lines ${this.params.start_line}-${this.params.end_line})`,
      fileName,
      filePath: this.params.absolute_path,
      fileDiff,
      originalContent,
      newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  async execute(): Promise<ToolResult> {
    const fileService = this.config.getFileSystemService();

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

    const lines = content.split('\n');

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

    const startIndex = this.params.start_line - 1;
    const count = this.params.end_line - this.params.start_line + 1;

    lines.splice(startIndex, count);

    const newContent = lines.join('\n');

    try {
      await fileService.writeTextFile(this.params.absolute_path, newContent);

      const linesDeleted = count;
      const mimetype = getSpecificMimeType(this.params.absolute_path);
      recordFileOperationMetric(
        this.config,
        FileOperation.UPDATE,
        linesDeleted,
        mimetype,
        path.extname(this.params.absolute_path),
      );

      // @plan PLAN-20250212-LSP.P31
      // @requirement REQ-DIAG-010
      // Append LSP diagnostics after successful edit
      const llmSuccessMessageParts: string[] = [
        `Successfully deleted lines ${this.params.start_line}-${this.params.end_line} from ${this.params.absolute_path}`,
      ];

      try {
        const lspClient = this.config.getLspServiceClient();
        if (lspClient && lspClient.isAlive()) {
          const diagnostics = await lspClient.checkFile(
            this.params.absolute_path,
          );
          const lspConfig = this.config.getLspConfig();
          const includeSeverities = lspConfig?.includeSeverities ?? ['error'];
          const filtered = diagnostics.filter((d) =>
            includeSeverities.includes(d.severity),
          );

          if (filtered.length > 0) {
            const maxPerFile = lspConfig?.maxDiagnosticsPerFile ?? 20;
            const relPath = path.relative(
              this.config.getTargetDir(),
              this.params.absolute_path,
            );
            const limited = filtered
              .sort(
                (a, b) =>
                  (a.line ?? 0) - (b.line ?? 0) ||
                  (a.column ?? 0) - (b.column ?? 0),
              )
              .slice(0, maxPerFile);

            const diagLines = limited
              .map((d) => {
                const codeStr = d.code !== undefined ? ` (${d.code})` : '';
                return `${d.severity.toUpperCase()} [${d.line ?? 1}:${d.column ?? 1}] ${d.message}${codeStr}`;
              })
              .join('\n');

            let suffix = '';
            if (filtered.length > maxPerFile) {
              suffix = `\n... and ${filtered.length - maxPerFile} more`;
            }

            llmSuccessMessageParts.push(
              `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${relPath}">\n${diagLines}${suffix}\n</diagnostics>`,
            );
          }
        }
      } catch (_error) {
        // LSP failure must never fail the edit (REQ-GRACE-050, REQ-GRACE-055)
        // Silently continue - edit was already successful
      }

      return {
        llmContent: llmSuccessMessageParts.join(' '),
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
