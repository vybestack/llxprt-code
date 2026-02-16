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
import { isNodeError } from '../utils/errors.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from './diffOptions.js';
import { IDEConnectionStatus } from '../ide/ide-client.js';

/**
 * Parameters for the InsertAtLine tool
 */
export interface InsertAtLineToolParams {
  /**
   * The absolute path to the file to modify
   */
  absolute_path: string;

  /**
   * The 1-based line number to insert before. Content will be inserted before this line.
   */
  line_number: number;

  /**
   * The content to insert
   */
  content: string;
}

class InsertAtLineToolInvocation extends BaseToolInvocation<
  InsertAtLineToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: InsertAtLineToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.absolute_path,
      this.config.getTargetDir(),
    );
    return `Insert content at line ${this.params.line_number} in ${shortenPath(relativePath)}`;
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.params.absolute_path, line: this.params.line_number }];
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

    let originalContent = '';
    let fileExists = true;
    try {
      originalContent = await fileService.readTextFile(
        this.params.absolute_path,
      );
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        fileExists = false;
        originalContent = '';
      } else {
        return false;
      }
    }

    const lines = originalContent.split('\n');
    const totalLines = lines.length;

    if (fileExists && this.params.line_number > totalLines + 1) {
      return false;
    }

    if (!fileExists && this.params.line_number !== 1) {
      return false;
    }

    const insertIndex = this.params.line_number - 1;
    const newLines = this.params.content.split('\n');
    const resultLines = [...lines];
    resultLines.splice(insertIndex, 0, ...newLines);
    const newContent = resultLines.join('\n');

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
      title: `Confirm Insert: ${shortenPath(relativePath)} (at line ${this.params.line_number})`,
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
    let fileExists = true;
    try {
      content = await fileService.readTextFile(this.params.absolute_path);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        if (this.params.line_number !== 1) {
          return {
            llmContent: `Cannot insert at line ${this.params.line_number}: file does not exist. For new files, you can only insert at line_number: 1`,
            returnDisplay: `Cannot insert at line ${this.params.line_number}: file does not exist`,
            error: {
              message: `File does not exist, can only insert at line 1`,
              type: ToolErrorType.INVALID_TOOL_PARAMS,
            },
          };
        }
        content = '';
        fileExists = false;
      } else {
        return {
          llmContent: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
          returnDisplay: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: ToolErrorType.FILE_NOT_FOUND,
          },
        };
      }
    }

    const lines = content.split('\n');

    const totalLines = lines.length;
    if (fileExists && this.params.line_number > totalLines + 1) {
      return {
        llmContent: `Cannot insert at line ${this.params.line_number}: exceeds file length (${totalLines}). Use line_number <= ${totalLines + 1} to append.`,
        returnDisplay: `Cannot insert at line ${this.params.line_number}: exceeds file length (${totalLines})`,
        error: {
          message: `line_number ${this.params.line_number} exceeds file length (${totalLines})`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const insertIndex = this.params.line_number - 1;

    const newLines = this.params.content.split('\n');

    lines.splice(insertIndex, 0, ...newLines);

    const newContent = lines.join('\n');

    try {
      await fileService.writeTextFile(this.params.absolute_path, newContent);

      const linesInserted = newLines.length;
      const mimetype = getSpecificMimeType(this.params.absolute_path);
      recordFileOperationMetric(
        this.config,
        fileExists ? FileOperation.UPDATE : FileOperation.CREATE,
        linesInserted,
        mimetype,
        path.extname(this.params.absolute_path),
      );

      const action = fileExists ? 'inserted' : 'created and inserted';

      // @plan PLAN-20250212-LSP.P31
      // @requirement REQ-DIAG-010
      // Append LSP diagnostics after successful edit
      const llmSuccessMessageParts: string[] = [
        `Successfully ${action} content at line ${this.params.line_number} in ${this.params.absolute_path}`,
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
        returnDisplay: `${action.charAt(0).toUpperCase() + action.slice(1)} ${linesInserted} lines at line ${this.params.line_number}`,
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
 * Implementation of the InsertAtLine tool logic
 */
export class InsertAtLineTool extends BaseDeclarativeTool<
  InsertAtLineToolParams,
  ToolResult
> {
  static readonly Name: string = 'insert_at_line';

  constructor(private config: Config) {
    super(
      InsertAtLineTool.Name,
      'InsertAtLine',
      `Inserts new content at a specific line in a file. This is the "paste" operation for refactoring. The 'line_number' is 1-based. The new content will be inserted *before* this line number. To prepend to the top of a file, use 'line_number: 1'. If 'line_number' is greater than the total lines, the content will be appended to the end of the file.`,
      Kind.Edit,
      {
        properties: {
          absolute_path: {
            description:
              "The absolute path to the file to modify. Must start with '/' and be within the workspace.",
            type: 'string',
          },
          line_number: {
            description:
              'The 1-based line number to insert before. Content will be inserted before this line.',
            type: 'number',
            minimum: 1,
          },
          content: {
            description: 'The content to insert at the specified line.',
            type: 'string',
          },
        },
        required: ['absolute_path', 'line_number', 'content'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: InsertAtLineToolParams,
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

    if (params.line_number < 1) {
      return 'line_number must be a positive integer (>= 1)';
    }

    if (!params.content) {
      return 'content parameter must be provided and non-empty';
    }

    const fileService = this.config.getFileService();
    if (fileService.shouldLlxprtIgnoreFile(params.absolute_path)) {
      return `File path '${params.absolute_path}' is ignored by .llxprtignore pattern(s).`;
    }

    return null;
  }

  protected createInvocation(
    params: InsertAtLineToolParams,
  ): ToolInvocation<InsertAtLineToolParams, ToolResult> {
    return new InsertAtLineToolInvocation(this.config, params);
  }
}
