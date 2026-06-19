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
import { stringOrDefault } from '../utils/stringCoalescing.js';

/**
 * Parameters for the InsertAtLine tool
 */
export interface InsertAtLineToolParams {
  /**
   * The absolute path to the file to modify
   */
  absolute_path?: string;

  /**
   * Alternative parameter name for absolute_path (for backward compatibility)
   */
  file_path?: string;

  /**
   * The 1-based line number to insert before. Content will be inserted before this line.
   */
  line_number: number;

  /**
   * The content to insert
   */
  content: string;
}

function splitInsertContent(content: string): string[] {
  return content.endsWith('\n')
    ? content.slice(0, -1).split('\n')
    : content.split('\n');
}

class InsertAtLineToolInvocation extends BaseToolInvocation<
  InsertAtLineToolParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    private readonly ideService: IIdeService | undefined,
    private readonly lspService: ILspService | undefined,
    params: InsertAtLineToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  private getFilePath(): string {
    return stringOrDefault(
      this.params.absolute_path,
      stringOrDefault(this.params.file_path, ''),
    );
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.getFilePath(),
      this.host.getTargetDir(),
    );
    return `Insert content at line ${this.params.line_number} in ${shortenPath(relativePath)}`;
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath(), line: this.params.line_number }];
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const approvalMode = this.host.getApprovalMode();
    if (approvalMode === 'auto' || approvalMode === 'yolo') {
      return false;
    }

    const filePath = this.getFilePath();
    let originalContent = '';
    let fileExists = true;
    try {
      originalContent = await fs.readFile(filePath, 'utf8');
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
    const newLines = splitInsertContent(this.params.content);
    const resultLines = [...lines];
    resultLines.splice(insertIndex, 0, ...newLines);
    const newContent = resultLines.join('\n');

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
      title: `Confirm Insert: ${shortenPath(relativePath)} (at line ${this.params.line_number})`,
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
    const state = await this.readFileState();
    if (!state.ok) return state.result;

    const lines = state.content.split('\n');
    const totalLines = lines.length;
    if (state.fileExists && this.params.line_number > totalLines + 1) {
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
    const newLines = splitInsertContent(this.params.content);
    lines.splice(insertIndex, 0, ...newLines);
    const newContent = lines.join('\n');

    return this.buildWriteResult(state.fileExists, newContent, newLines);
  }

  private async readFileState(): Promise<
    | { ok: true; content: string; fileExists: boolean }
    | { ok: false; result: ToolResult }
  > {
    const filePath = this.getFilePath();
    let content: string;
    let fileExists = true;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        if (this.params.line_number !== 1) {
          return {
            ok: false,
            result: {
              llmContent: `Cannot insert at line ${this.params.line_number}: file does not exist. For new files, you can only insert at line_number: 1`,
              returnDisplay: `Cannot insert at line ${this.params.line_number}: file does not exist`,
              error: {
                message: `File does not exist, can only insert at line 1`,
                type: ToolErrorType.INVALID_TOOL_PARAMS,
              },
            },
          };
        }
        content = '';
        fileExists = false;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          result: {
            llmContent: `Error reading file: ${message}`,
            returnDisplay: `Error reading file: ${message}`,
            error: {
              message,
              type: ToolErrorType.FILE_NOT_FOUND,
            },
          },
        };
      }
    }
    return { ok: true, content, fileExists };
  }

  private async buildWriteResult(
    fileExists: boolean,
    newContent: string,
    newLines: string[],
  ): Promise<ToolResult> {
    const filePath = this.getFilePath();
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, newContent, 'utf8');

      const linesInserted = newLines.length;
      this.recordMetrics(filePath, fileExists, linesInserted);

      const action = fileExists ? 'inserted' : 'created and inserted';

      const llmSuccessMessageParts: string[] = [
        `Successfully ${action} content at line ${this.params.line_number} in ${filePath}`,
        this.params.content,
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
        returnDisplay: `${action.charAt(0).toUpperCase() + action.slice(1)} ${linesInserted} lines at line ${this.params.line_number}`,
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

  private recordMetrics(
    filePath: string,
    fileExists: boolean,
    linesInserted: number,
  ): void {
    const mimetype = getSpecificMimeType(filePath);
    const extension = path.extname(filePath);
    void fileExists;
    void linesInserted;
    void mimetype;
    void extension;
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

  constructor(
    private readonly host: IToolHost,
    private readonly ideService?: IIdeService,
    private readonly lspService?: ILspService,
  ) {
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
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file to modify.',
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
        required: ['line_number', 'content'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: InsertAtLineToolParams,
  ): string | null {
    const filePath = stringOrDefault(
      params.absolute_path,
      stringOrDefault(params.file_path, ''),
    );

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

    if (params.line_number < 1) {
      return 'line_number must be a positive integer (>= 1)';
    }

    if (!params.content) {
      return 'content parameter must be provided and non-empty';
    }

    const fileService = this.host.getFileService();
    if (fileService.shouldLlxprtIgnoreFile(filePath)) {
      return `File path '${filePath}' is ignored by .llxprtignore pattern(s).`;
    }

    return null;
  }

  protected createInvocation(
    params: InsertAtLineToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<InsertAtLineToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new InsertAtLineToolInvocation(
      this.host,
      this.ideService,

      this.lspService,
      normalizedParams,
      messageBus,
    );
  }

  async execute(
    params: InsertAtLineToolParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    return this.build(params).execute(signal);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
