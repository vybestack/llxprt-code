/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import * as Diff from 'diff';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolResult,
  type FileDiff,
  Kind,
  type ToolLocation,
  type ToolInvocation,
  type ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
} from './tools.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { getErrorMessage, isNodeError } from '../utils/errors.js';
import {
  DEFAULT_CREATE_PATCH_OPTIONS,
  getDiffStat,
} from '../utils/diffOptions.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from './modifiable-tool.js';
import { getSpecificMimeType } from '../utils/fileUtils.js';
import { debugLogger } from '../utils/debugLogger.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';

/**
 * Parameters for the WriteFile tool
 */
export interface WriteFileToolParams {
  /**
   * The absolute path to the file to write to
   */
  absolute_path?: string;

  /**
   * Alternative parameter name for absolute_path (for compatibility)
   * Not shown in schema - internal use only
   */
  file_path?: string;

  /**
   * The content to write to the file
   */
  content: string;

  /**
   * Whether the proposed content was modified by the user.
   */
  modified_by_user?: boolean;

  /**
   * Initially proposed content.
   */
  ai_proposed_content?: string;
}

interface GetCorrectedFileContentResult {
  originalContent: string;
  correctedContent: string;
  fileExists: boolean;
  error?: { message: string; code?: string };
}

/**
 * Gets corrected file content — preserves trailing newline for existing files.
 */
async function getCorrectedFileContent(
  filePath: string,
  proposedContent: string,
  _host: IToolHost,
): Promise<GetCorrectedFileContentResult> {
  let originalContent = '';
  let fileExists = false;
  let correctedContent = proposedContent;

  try {
    originalContent = await fs.promises.readFile(filePath, 'utf-8');
    fileExists = true;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      fileExists = false;
      originalContent = '';
    } else {
      fileExists = true;
      originalContent = '';
      const error = {
        message: getErrorMessage(err),
        code: isNodeError(err) ? err.code : undefined,
      };
      return { originalContent, correctedContent, fileExists, error };
    }
  }

  correctedContent = proposedContent;
  const preserveTrailingNewline = fileExists && originalContent.endsWith('\n');
  if (
    preserveTrailingNewline &&
    correctedContent.length > 0 &&
    !correctedContent.endsWith('\n')
  ) {
    correctedContent = `${correctedContent}\n`;
  }
  return { originalContent, correctedContent, fileExists };
}

class WriteFileToolInvocation extends BaseToolInvocation<
  WriteFileToolParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    params: WriteFileToolParams,
    messageBus: IToolMessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  override getToolName(): string {
    return WriteFileTool.Name;
  }

  private getFilePath(): string {
    return stringOrDefault(
      this.params.absolute_path,
      stringOrDefault(this.params.file_path, ''),
    );
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath() }];
  }

  override getDescription(): string {
    const filePath = this.getFilePath();
    if (!filePath || !this.params.content) {
      return `Model did not provide valid parameters for write file tool`;
    }
    const relativePath = makeRelative(filePath, this.host.getTargetDir());
    return `Writing to ${shortenPath(relativePath)}`;
  }

  override async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.messageBus) {
      const decision = await this.getMessageBusDecision(abortSignal);
      if (decision === 'ALLOW') {
        return false;
      }
      if (decision === 'DENY') {
        throw new Error('Tool execution denied by policy.');
      }
    }

    if (this.host.getApprovalMode() === 'auto') {
      return false;
    }

    const filePath = this.getFilePath();
    const correctedContentResult = await getCorrectedFileContent(
      filePath,
      this.params.content,
      this.host,
    );
    const fileName = path.basename(filePath);
    const originalContent = correctedContentResult.originalContent;
    const newContent = correctedContentResult.correctedContent;
    const fileDiff = Diff.createPatch(
      fileName,
      originalContent,
      newContent,
      'Original',
      'Written',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

    return {
      type: 'edit',
      title: 'Confirm Write File',
      fileName,
      filePath,
      fileDiff,
      originalContent,
      newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.host.setApprovalMode('auto');
        } else {
          await this.publishPolicyUpdate(outcome);
        }
      },
    };
  }

  async execute(_abortSignal: AbortSignal): Promise<ToolResult> {
    const filePath = this.getFilePath();
    const correctedContentResult = await getCorrectedFileContent(
      filePath,
      this.params.content,
      this.host,
    );

    if (correctedContentResult.error) {
      const errDetails = correctedContentResult.error;
      const errorMsg = errDetails.code
        ? `Error checking existing file '${filePath}': ${errDetails.message} (${errDetails.code})`
        : `Error checking existing file: ${errDetails.message}`;
      return {
        llmContent: errorMsg,
        returnDisplay: errorMsg,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }

    const {
      originalContent,
      correctedContent: fileContent,
      fileExists,
    } = correctedContentResult;
    const isNewFile = !fileExists;

    try {
      return await this.writeFile(
        filePath,
        fileContent,
        originalContent,
        isNewFile,
      );
    } catch (error) {
      return this.createWriteError(filePath, error);
    }
  }

  private async writeFile(
    filePath: string,
    fileContent: string,
    originalContent: string,
    isNewFile: boolean,
  ): Promise<ToolResult> {
    const dirName = path.dirname(filePath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }

    fs.writeFileSync(filePath, fileContent, 'utf-8');

    const fileName = path.basename(filePath);
    const fileDiff = Diff.createPatch(
      fileName,
      originalContent,
      fileContent,
      'Original',
      'Written',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

    const originallyProposedContent =
      this.params.ai_proposed_content ?? this.params.content;
    const diffStat = getDiffStat(
      fileName,
      originalContent,
      originallyProposedContent,
      this.params.content,
    );

    const llmSuccessMessageParts = this.buildSuccessMessageParts(isNewFile);

    this.recordMetrics(filePath, fileContent, isNewFile, diffStat);

    const displayResult: FileDiff = {
      fileDiff,
      fileName,
      filePath,
      originalContent,
      newContent: fileContent,
      diffStat,
      isNewFile,
    };

    const result: ToolResult = {
      llmContent: llmSuccessMessageParts.join('\n\n'),
      returnDisplay: displayResult,
    };

    return result;
  }

  private buildSuccessMessageParts(isNewFile: boolean): string[] {
    const displayPath = stringOrDefault(
      this.params.absolute_path,
      stringOrDefault(this.params.file_path, ''),
    );
    const parts = [
      isNewFile
        ? `Successfully created and wrote to new file: ${displayPath}.`
        : `Successfully overwrote file: ${displayPath}.`,
    ];
    if (this.params.modified_by_user === true) {
      parts.push(`User modified the \`content\` to be: ${this.params.content}`);
    }
    return parts;
  }

  private recordMetrics(
    filePath: string,
    fileContent: string,
    isNewFile: boolean,
    diffStat: ReturnType<typeof getDiffStat>,
  ): void {
    const lines = fileContent.split('\n').length;
    const mimetype = getSpecificMimeType(filePath);
    const extension = path.extname(filePath);
    void lines;
    void mimetype;
    void extension;
    void diffStat;
    void isNewFile;
    // Metrics recording deferred to core adapter layer
  }

  private createWriteError(filePath: string, error: unknown): ToolResult {
    let errorMsg: string;
    let errorType = ToolErrorType.FILE_WRITE_FAILURE;

    if (isNodeError(error)) {
      errorMsg = `Error writing to file '${filePath}': ${error.message} (${error.code})`;

      if (error.code === 'EACCES') {
        errorMsg = `Permission denied writing to file: ${filePath} (${error.code})`;
        errorType = ToolErrorType.PERMISSION_DENIED;
      } else if (error.code === 'ENOSPC') {
        errorMsg = `No space left on device: ${filePath} (${error.code})`;
        errorType = ToolErrorType.NO_SPACE_LEFT;
      } else if (error.code === 'EISDIR') {
        errorMsg = `Target is a directory, not a file: ${filePath} (${error.code})`;
        errorType = ToolErrorType.TARGET_IS_DIRECTORY;
      }

      if (this.host.getDebugMode() && error.stack) {
        debugLogger.error('Write file error stack:', error.stack);
      }
    } else if (error instanceof Error) {
      errorMsg = `Error writing to file: ${error.message}`;
    } else {
      errorMsg = `Error writing to file: ${String(error)}`;
    }

    return {
      llmContent: errorMsg,
      returnDisplay: errorMsg,
      error: {
        message: errorMsg,
        type: errorType,
      },
    };
  }
}

/**
 * Implementation of the WriteFile tool logic
 */
export class WriteFileTool
  extends BaseDeclarativeTool<WriteFileToolParams, ToolResult>
  implements ModifiableDeclarativeTool<WriteFileToolParams>
{
  static readonly Name: string = 'write_file';

  constructor(
    private host: IToolHost,
    messageBus?: IToolMessageBus,
  ) {
    super(
      WriteFileTool.Name,
      'WriteFile',
      `Writes content to a specified file in the local filesystem.

      The user has the ability to modify \`content\`. If modified, this will be stated in the response.`,
      Kind.Edit,
      {
        properties: {
          absolute_path: {
            description:
              "The absolute path to the file to write to (e.g., '/home/user/project/file.txt'). Relative paths are not supported.",
            type: 'string',
          },
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for compatibility). The absolute path to the file to write.',
            type: 'string',
          },
          content: {
            description: 'The content to write to the file.',
            type: 'string',
          },
        },
        required: ['content'],
        type: 'object',
      },
      true,
      false,
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: WriteFileToolParams,
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

    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.lstatSync(filePath);
        if (stats.isDirectory()) {
          return `Path is a directory, not a file: ${filePath}`;
        }
      }
    } catch (statError: unknown) {
      return `Error accessing path properties for validation: ${filePath}. Reason: ${statError instanceof Error ? statError.message : String(statError)}`;
    }

    return null;
  }

  protected createInvocation(
    params: WriteFileToolParams,
    messageBus?: IToolMessageBus,
    toolName?: string,
    displayName?: string,
  ): ToolInvocation<WriteFileToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new WriteFileToolInvocation(
      this.host,
      normalizedParams,
      messageBus as IToolMessageBus,
      toolName ?? this.name,
      displayName ?? this.displayName,
    );
  }

  getModifyContext(
    _abortSignal: AbortSignal,
  ): ModifyContext<WriteFileToolParams> {
    return {
      getFilePath: (params: WriteFileToolParams) =>
        stringOrDefault(
          params.absolute_path,
          stringOrDefault(params.file_path, ''),
        ),
      getCurrentContent: async (params: WriteFileToolParams) => {
        const filePath = stringOrDefault(
          params.absolute_path,
          stringOrDefault(params.file_path, ''),
        );
        const correctedContentResult = await getCorrectedFileContent(
          filePath,
          params.content,
          this.host,
        );
        return correctedContentResult.originalContent;
      },
      getProposedContent: async (params: WriteFileToolParams) => {
        const filePath = stringOrDefault(
          params.absolute_path,
          stringOrDefault(params.file_path, ''),
        );
        const correctedContentResult = await getCorrectedFileContent(
          filePath,
          params.content,
          this.host,
        );
        return correctedContentResult.correctedContent;
      },
      createUpdatedParams: (
        _oldContent: string,
        modifiedProposedContent: string,
        originalParams: WriteFileToolParams,
      ) => {
        const content = originalParams.content;
        return {
          ...originalParams,
          ai_proposed_content: content,
          content: modifiedProposedContent,
          modified_by_user: true,
        };
      },
    };
  }
}
