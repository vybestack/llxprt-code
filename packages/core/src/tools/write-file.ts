/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import * as Diff from 'diff';
import { Config, ApprovalMode } from '../config/config.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolResult,
  type FileDiff,
  type ToolEditConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  Kind,
  type ToolLocation,
  type ToolInvocation,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { getErrorMessage, isNodeError } from '../utils/errors.js';
import { DEFAULT_DIFF_OPTIONS, getDiffStat } from './diffOptions.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from './modifiable-tool.js';
import { getSpecificMimeType } from '../utils/fileUtils.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';
import { IDEConnectionStatus } from '../ide/ide-client.js';
import { getGitStatsService } from '../services/git-stats-service.js';
import { EmojiFilter } from '../filters/EmojiFilter.js';

/**
 * Gets emoji filter instance based on configuration
 */
function getEmojiFilter(config: Config): EmojiFilter {
  // Get emojifilter from ephemeral settings or default to 'auto'
  const mode =
    (config.getEphemeralSetting('emojifilter') as
      | 'allowed'
      | 'auto'
      | 'warn'
      | 'error') || 'auto';

  // Map auto to warn for file operations (we want warnings when filtering files)
  let filterMode: 'allowed' | 'warn' | 'error';
  if (mode === 'allowed') {
    filterMode = 'allowed';
  } else if (mode === 'auto' || mode === 'warn') {
    filterMode = 'warn';
  } else {
    filterMode = 'error';
  }

  return new EmojiFilter({ mode: filterMode });
}

/**
 * Parameters for the WriteFile tool
 */
export interface WriteFileToolParams {
  /**
   * The absolute path to the file to write to
   */
  file_path?: string;

  /**
   * Alternative parameter name for file_path (for compatibility)
   * Not shown in schema - internal use only
   */
  absolute_path?: string;

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
 * Gets corrected file content using AI correction services
 */
export async function getCorrectedFileContent(
  filePath: string,
  proposedContent: string,
  config: Config,
  _abortSignal: AbortSignal,
): Promise<GetCorrectedFileContentResult> {
  let originalContent = '';
  let fileExists = false;
  let correctedContent = proposedContent;

  try {
    originalContent = await config
      .getFileSystemService()
      .readTextFile(filePath);
    fileExists = true; // File exists and was read
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      fileExists = false;
      originalContent = '';
    } else {
      // File exists but could not be read (permissions, etc.)
      fileExists = true; // Mark as existing but problematic
      originalContent = ''; // Can't use its content
      const error = {
        message: getErrorMessage(err),
        code: isNodeError(err) ? err.code : undefined,
      };
      // Return early as we can't proceed with content correction meaningfully
      return { originalContent, correctedContent, fileExists, error };
    }
  }

  // If readError is set, we have returned.
  // So, file was either read successfully (fileExists=true, originalContent set)
  // or it was ENOENT (fileExists=false, originalContent='').

  // Use the proposed content directly without correction
  correctedContent = proposedContent;
  // Preserve trailing newline when overwriting an existing file.
  // This avoids unintentionally deleting the final newline when models provide
  // content without one.
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
    private readonly config: Config,
    params: WriteFileToolParams,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus);
  }

  override getToolName(): string {
    return WriteFileTool.Name;
  }

  private getFilePath(): string {
    // Use file_path if provided, otherwise fall back to absolute_path
    return this.params.file_path || this.params.absolute_path || '';
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath() }];
  }

  override getDescription(): string {
    const filePath = this.getFilePath();
    if (!filePath || !this.params.content) {
      return `Model did not provide valid parameters for write file tool`;
    }
    const relativePath = makeRelative(filePath, this.config.getTargetDir());
    return `Writing to ${shortenPath(relativePath)}`;
  }

  /**
   * Handles the confirmation prompt for the WriteFile tool.
   */
  override async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const approvalMode = this.config.getApprovalMode();
    if (
      approvalMode === ApprovalMode.AUTO_EDIT ||
      approvalMode === ApprovalMode.YOLO
    ) {
      return false;
    }

    // Apply emoji filtering to params.content FIRST, before any processing
    const filter = getEmojiFilter(this.config);
    const filterResult = filter.filterFileContent(
      this.params.content,
      'write_file',
    );

    // If blocked in error mode, return false to prevent confirmation
    if (filterResult.blocked) {
      return false;
    }

    // Update params.content with filtered content for all downstream processing
    const filteredParamsContent =
      typeof filterResult.filtered === 'string'
        ? filterResult.filtered
        : this.params.content;

    const filePath = this.getFilePath();
    const correctedContentResult = await getCorrectedFileContent(
      filePath,
      filteredParamsContent, // Use filtered content
      this.config,
      abortSignal,
    );

    if (correctedContentResult.error) {
      // If file exists but couldn't be read, we can't show a diff for confirmation.
      return false;
    }

    const { originalContent, correctedContent } = correctedContentResult;

    const relativePath = makeRelative(filePath, this.config.getTargetDir());
    const fileName = path.basename(filePath);

    const fileDiff = Diff.createPatch(
      fileName,
      originalContent, // Original content (empty if new file or unreadable)
      correctedContent, // Content after correction and emoji filtering
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS,
    );

    const ideClient = this.config.getIdeClient();
    const ideConfirmation =
      this.config.getIdeMode() &&
      ideClient &&
      ideClient.getConnectionStatus().status === IDEConnectionStatus.Connected
        ? ideClient.openDiff(filePath, correctedContent)
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Write: ${shortenPath(relativePath)}`,
      fileName,
      filePath,
      fileDiff,
      originalContent,
      newContent: correctedContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }

        if (ideConfirmation) {
          const result = await ideConfirmation;
          if (result.status === 'accepted' && result.content) {
            this.params.content = result.content;
          }
        } else {
          // Update params.content with the filtered content so execute() uses it
          this.params.content = correctedContent;
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  async execute(abortSignal: AbortSignal): Promise<ToolResult> {
    // Apply emoji filtering to file content
    const filter = getEmojiFilter(this.config);
    const filterResult = filter.filterFileContent(
      this.params.content,
      'write_file',
    );

    // Handle blocking in error mode
    if (filterResult.blocked) {
      return {
        llmContent:
          filterResult.error || 'File write blocked due to emoji content',
        returnDisplay:
          filterResult.error || 'File write blocked due to emoji content',
        error: {
          message:
            filterResult.error || 'File write blocked due to emoji content',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Use filtered content
    const filteredParams = {
      ...this.params,
      content: filterResult.filtered as string,
    };

    const filePath = this.getFilePath();
    const correctedContentResult = await getCorrectedFileContent(
      filePath,
      filteredParams.content,
      this.config,
      abortSignal,
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
    // fileExists is true if the file existed (and was readable or unreadable but caught by readError).
    // fileExists is false if the file did not exist (ENOENT).
    const isNewFile =
      !fileExists ||
      (correctedContentResult.error !== undefined &&
        !correctedContentResult.fileExists);

    try {
      const dirName = path.dirname(filePath);
      if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
      }

      await this.config
        .getFileSystemService()
        .writeTextFile(filePath, fileContent);

      // Track git stats if logging is enabled and service is available
      let gitStats = null;
      if (this.config.getConversationLoggingEnabled()) {
        const gitStatsService = getGitStatsService();
        if (gitStatsService) {
          try {
            gitStats = await gitStatsService.trackFileEdit(
              filePath,
              originalContent || '',
              fileContent,
            );
          } catch (error) {
            // Don't fail the write if git stats tracking fails
            console.warn('Failed to track git stats:', error);
          }
        }
      }

      // Generate diff for display result
      const fileName = path.basename(filePath);
      // If there was a readError, originalContent in correctedContentResult is '',
      // but for the diff, we want to show the original content as it was before the write if possible.
      // However, if it was unreadable, currentContentForDiff will be empty.
      const currentContentForDiff = correctedContentResult.error
        ? '' // Or some indicator of unreadable content
        : originalContent;

      const fileDiff = Diff.createPatch(
        fileName,
        currentContentForDiff,
        fileContent,
        'Original',
        'Written',
        DEFAULT_DIFF_OPTIONS,
      );

      const originallyProposedContent =
        filteredParams.ai_proposed_content || filteredParams.content;
      const diffStat = getDiffStat(
        fileName,
        currentContentForDiff,
        originallyProposedContent,
        filteredParams.content,
      );

      const llmSuccessMessageParts = [
        isNewFile
          ? `Successfully created and wrote to new file: ${filteredParams.file_path}.`
          : `Successfully overwrote file: ${filteredParams.file_path}.`,
      ];
      if (filteredParams.modified_by_user) {
        llmSuccessMessageParts.push(
          `User modified the \`content\` to be: ${filteredParams.content}`,
        );
      }

      // Add system feedback for emoji filtering if detected
      if (filterResult.systemFeedback) {
        llmSuccessMessageParts.push(
          `\n\n<system-reminder>\n${filterResult.systemFeedback}\n</system-reminder>`,
        );
      }

      const displayResult: FileDiff = {
        fileDiff,
        fileName,
        originalContent: correctedContentResult.originalContent,
        newContent: correctedContentResult.correctedContent,
        diffStat,
      };

      const lines = fileContent.split('\n').length;
      const mimetype = getSpecificMimeType(filePath);
      const extension = path.extname(filePath); // Get extension
      if (isNewFile) {
        recordFileOperationMetric(
          this.config,
          FileOperation.CREATE,
          lines,
          mimetype,
          extension,
          diffStat,
        );
      } else {
        recordFileOperationMetric(
          this.config,
          FileOperation.UPDATE,
          lines,
          mimetype,
          extension,
          diffStat,
        );
      }

      const result: ToolResult = {
        llmContent: llmSuccessMessageParts.join(' '),
        returnDisplay: displayResult,
      };

      // Include git stats in metadata if available
      if (gitStats) {
        result.metadata = {
          ...result.metadata,
          gitStats,
        };
      }

      return result;
    } catch (error) {
      // Capture detailed error information for debugging
      let errorMsg: string;
      let errorType = ToolErrorType.FILE_WRITE_FAILURE;

      if (isNodeError(error)) {
        // Handle specific Node.js errors with their error codes
        errorMsg = `Error writing to file '${filePath}': ${error.message} (${error.code})`;

        // Log specific error types for better debugging
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

        // Include stack trace in debug mode for better troubleshooting
        if (this.config.getDebugMode() && error.stack) {
          console.error('Write file error stack:', error.stack);
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
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      WriteFileTool.Name,
      'WriteFile',
      `Writes content to a specified file in the local filesystem.

      The user has the ability to modify \`content\`. If modified, this will be stated in the response.`,
      Kind.Edit,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to write to (e.g., '/home/user/project/file.txt'). Relative paths are not supported.",
            type: 'string',
          },
          absolute_path: {
            description:
              'Alternative parameter name for file_path (for compatibility). The absolute path to the file to write.',
            type: 'string',
          },
          content: {
            description: 'The content to write to the file.',
            type: 'string',
          },
        },
        required: ['content'], // Content is always required, path validation in validateToolParamValues
        type: 'object',
      },
      true, // output is markdown
      false, // output cannot be updated
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: WriteFileToolParams,
  ): string | null {
    // Accept either file_path or absolute_path
    const filePath = params.file_path || params.absolute_path || '';

    if (filePath.trim() === '') {
      return "The 'file_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(filePath)) {
      return `File path must be absolute: ${filePath}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(filePath)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    try {
      // This check should be performed only if the path exists.
      // If it doesn't exist, it's a new file, which is valid for writing.
      if (fs.existsSync(filePath)) {
        const stats = fs.lstatSync(filePath);
        if (stats.isDirectory()) {
          return `Path is a directory, not a file: ${filePath}`;
        }
      }
    } catch (statError: unknown) {
      // If fs.existsSync is true but lstatSync fails (e.g., permissions, race condition where file is deleted)
      // this indicates an issue with accessing the path that should be reported.
      return `Error accessing path properties for validation: ${filePath}. Reason: ${statError instanceof Error ? statError.message : String(statError)}`;
    }

    return null;
  }

  protected createInvocation(
    params: WriteFileToolParams,
    messageBus?: MessageBus,
  ): ToolInvocation<WriteFileToolParams, ToolResult> {
    // Normalize parameters: if absolute_path is provided but not file_path, copy it over
    const normalizedParams = { ...params };
    if (!normalizedParams.file_path && normalizedParams.absolute_path) {
      normalizedParams.file_path = normalizedParams.absolute_path;
    }
    return new WriteFileToolInvocation(
      this.config,
      normalizedParams,
      messageBus,
    );
  }

  getModifyContext(
    abortSignal: AbortSignal,
  ): ModifyContext<WriteFileToolParams> {
    return {
      getFilePath: (params: WriteFileToolParams) =>
        params.file_path || params.absolute_path || '',
      getCurrentContent: async (params: WriteFileToolParams) => {
        const filePath = params.file_path || params.absolute_path || '';
        const correctedContentResult = await getCorrectedFileContent(
          filePath,
          params.content,
          this.config,
          abortSignal,
        );
        return correctedContentResult.originalContent;
      },
      getProposedContent: async (params: WriteFileToolParams) => {
        const filePath = params.file_path || params.absolute_path || '';
        const correctedContentResult = await getCorrectedFileContent(
          filePath,
          params.content,
          this.config,
          abortSignal,
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
