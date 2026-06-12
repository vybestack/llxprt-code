/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
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
import type {
  IIdeService,
  ILspService,
  IToolHost,
  IToolMessageBus,
} from '../interfaces/index.js';
import { ToolErrorType } from '../types/tool-error.js';
import { getSpecificMimeType } from '../utils/fileUtils.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from '../utils/diffOptions.js';
import { collectLspDiagnosticsBlock } from '../utils/lsp-diagnostics-helper.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';

/**
 * Parameters for the DeleteLineRange tool
 */
export interface DeleteLineRangeToolParams {
  /**
   * The absolute path to the file to modify
   */
  absolute_path?: string;

  /**
   * Alternative parameter name for absolute_path (for backward compatibility)
   */
  file_path?: string;

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
    private readonly host: IToolHost,
    private readonly ideService: IIdeService | undefined,
    private readonly lspService: ILspService | undefined,
    params: DeleteLineRangeToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  private getFilePath(): string {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
    return this.params.absolute_path || this.params.file_path || '';
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.getFilePath(),
      this.host.getTargetDir(),
    );
    return `Delete lines ${this.params.start_line}-${this.params.end_line} from ${shortenPath(relativePath)}`;
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath(), line: this.params.start_line }];
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const approvalMode = this.host.getApprovalMode();
    if (approvalMode === 'auto' || approvalMode === 'yolo') {
      return false;
    }

    const filePath = this.getFilePath();
    let originalContent: string;
    try {
      originalContent = await fs.readFile(filePath, 'utf8');
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

    const relativePath = makeRelative(filePath, this.host.getTargetDir());
    const fileName = path.basename(filePath);

    const fileDiff = Diff.createPatch(
      fileName,
      originalContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

    const ideConfirmation =
      this.ideService?.getConnectionStatus() === 'connected'
        ? this.ideService.applyDiff({ filePath, diff: newContent })
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Delete: ${shortenPath(relativePath)} (lines ${this.params.start_line}-${this.params.end_line})`,
      fileName,
      filePath,
      fileDiff,
      originalContent,
      newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.host.setApprovalMode('auto');
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  async execute(): Promise<ToolResult> {
    const filePath = this.getFilePath();
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error reading file: ${message}`,
        returnDisplay: `Error reading file: ${message}`,
        error: {
          message,
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

    const deletedContent = lines
      .slice(startIndex, startIndex + count)
      .join('\n');
    lines.splice(startIndex, count);

    const newContent = lines.join('\n');

    try {
      await fs.writeFile(filePath, newContent, 'utf8');

      this.recordMetrics(filePath, count);

      const llmSuccessMessageParts: string[] = [
        `Successfully deleted lines ${this.params.start_line}-${this.params.end_line} from ${filePath}`,
        deletedContent,
      ];

      try {
        const diagBlock =
          this.lspService === undefined
            ? null
            : await collectLspDiagnosticsBlock(
                this.lspService,
                this.host,
                filePath,
              );
        if (diagBlock) {
          llmSuccessMessageParts.push(diagBlock);
        }
      } catch {
        // LSP failure must never fail the edit (REQ-GRACE-050, REQ-GRACE-055)
      }

      return {
        llmContent: llmSuccessMessageParts.join('\n\n'),
        returnDisplay: `Deleted ${count} lines (${this.params.start_line}-${this.params.end_line})`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error writing file: ${message}`,
        returnDisplay: `Error writing file: ${message}`,
        error: {
          message,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }

  private recordMetrics(filePath: string, linesDeleted: number): void {
    const mimetype = getSpecificMimeType(filePath);
    const extension = path.extname(filePath);
    void linesDeleted;
    void mimetype;
    void extension;
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

  constructor(
    private readonly host: IToolHost,
    private readonly ideService?: IIdeService,
    private readonly lspService?: ILspService,
  ) {
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
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file to modify.',
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
        required: ['start_line', 'end_line'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: DeleteLineRangeToolParams,
  ): string | null {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid
    const filePath = params.absolute_path || params.file_path || '';

    if (filePath.trim() === '') {
      return "Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.";
    }

    if (!path.isAbsolute(filePath)) {
      return `File path must be absolute: ${filePath}`;
    }

    const pathError = validatePathWithinWorkspace(
      this.host.getWorkspaceRoots(),
      filePath,
    );
    if (pathError) {
      return pathError;
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

    const fileService = this.host.getFileService();
    if (fileService.shouldLlxprtIgnoreFile(filePath)) {
      return `File path '${filePath}' is ignored by .llxprtignore pattern(s).`;
    }

    return null;
  }

  protected createInvocation(
    params: DeleteLineRangeToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<DeleteLineRangeToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new DeleteLineRangeToolInvocation(
      this.host,
      this.ideService,
      this.lspService,
      normalizedParams,
      messageBus,
    );
  }

  async execute(
    params: DeleteLineRangeToolParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    return this.build(params).execute(signal);
  }
}
