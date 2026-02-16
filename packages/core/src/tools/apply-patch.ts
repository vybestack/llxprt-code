/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @plan PLAN-20250212-LSP.P31 */
/* @requirement REQ-DIAG-010, REQ-DIAG-040, REQ-DIAG-070, REQ-GRACE-050, REQ-GRACE-055 */

import * as Diff from 'diff';
import * as path from 'path';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolEditConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
  type FileDiff,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { Config, ApprovalMode } from '../config/config.js';
import { DEFAULT_CREATE_PATCH_OPTIONS, getDiffStat } from './diffOptions.js';
import { IDEConnectionStatus } from '../ide/ide-client.js';
import { getGitStatsService } from '../services/git-stats-service.js';
import { APPLY_PATCH_TOOL } from './tool-names.js';

/**
 * Type representing a parsed patch operation
 */
export type PatchOperation = Diff.StructuredPatch;

/**
 * Classifies patch operations to determine which files have content writes.
 * Patches with hunks represent content modifications/creations.
 * Patches without hunks are treated as rename/delete-only operations.
 *
 * @param operations - Array of parsed patch operations
 * @returns Object containing content write file paths and boolean flag
 */
export function classifyPatchOperations(operations: PatchOperation[]): {
  contentWriteFiles: string[];
  hasAnyContentWrites: boolean;
} {
  const contentWriteFiles: string[] = [];

  for (const op of operations) {
    // Patches with hunks represent content changes
    if (op.hunks.length > 0) {
      // Use newFileName as the target file
      contentWriteFiles.push(op.newFileName);
    }
    // Patches with no hunks are rename/delete-only - no content write
  }

  return {
    contentWriteFiles,
    hasAnyContentWrites: contentWriteFiles.length > 0,
  };
}

/**
 * Parameters for the ApplyPatch tool
 */
export interface ApplyPatchToolParams {
  /**
   * The absolute path to the file to modify
   */
  absolute_path?: string;

  /**
   * Alternative parameter name for absolute_path (for compatibility)
   * Not shown in schema - internal use only
   */
  file_path?: string;

  /**
   * The unified diff format patch content to apply
   */
  patch_content: string;

  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;

  /**
   * Initially proposed content.
   */
  ai_proposed_content?: string;
}

class ApplyPatchToolInvocation extends BaseToolInvocation<
  ApplyPatchToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ApplyPatchToolParams,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus);
  }

  override getToolName(): string {
    return ApplyPatchTool.Name;
  }

  private getFilePath(): string {
    return this.params.absolute_path || this.params.file_path || '';
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath() }];
  }

  override getDescription(): string {
    const filePath = this.getFilePath();
    const relativePath = makeRelative(filePath, this.config.getTargetDir());
    return `Apply patch to ${shortenPath(relativePath)}`;
  }

  /**
   * Returns confirmation details for this patch operation.
   */
  protected override getConfirmationDetails(): ToolCallConfirmationDetails | null {
    return null;
  }

  /**
   * Handles the confirmation prompt for the ApplyPatch tool.
   */
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

    const filePath = this.getFilePath();
    let currentContent = '';

    try {
      currentContent = await this.config
        .getFileSystemService()
        .readTextFile(filePath);
    } catch (err: unknown) {
      // File doesn't exist yet - will be created
      const nodeError = err as { code?: string };
      if (nodeError.code !== 'ENOENT') {
        throw err;
      }
    }

    // Parse and apply patch to get preview
    const patches = Diff.parsePatch(this.params.patch_content);
    const newContentResult = Diff.applyPatch(currentContent, patches[0]);

    if (typeof newContentResult !== 'string') {
      return false;
    }

    const newContent = newContentResult;

    const relativePath = makeRelative(filePath, this.config.getTargetDir());
    const fileName = path.basename(filePath);

    const fileDiffResult = Diff.createPatch(
      fileName,
      currentContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

    if (!fileDiffResult) {
      return false;
    }

    const fileDiff = fileDiffResult;

    const ideClient = this.config.getIdeClient();
    const ideConfirmation =
      this.config.getIdeMode() &&
      ideClient?.getConnectionStatus().status === IDEConnectionStatus.Connected
        ? ideClient.openDiff(filePath, newContent)
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Apply Patch: ${shortenPath(relativePath)}`,
      fileName,
      filePath,
      fileDiff,
      originalContent: currentContent,
      newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }

        if (ideConfirmation) {
          const result = await ideConfirmation;
          if (result.status === 'accepted' && result.content) {
            // User modified content in IDE - we'd need to regenerate patch
            // For now, we don't support this flow for apply_patch
          }
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  /**
   * Executes the apply_patch operation
   */
  override async execute(_signal: AbortSignal): Promise<ToolResult> {
    const filePath = this.getFilePath();

    // Validate file path is within workspace
    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(filePath)) {
      const directories = workspaceContext.getDirectories();
      return {
        llmContent: `File path must be within one of the workspace directories: ${directories.join(', ')}`,
        returnDisplay: `Error: File path outside workspace`,
        error: {
          message: `File path must be within workspace`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Read current content
    let currentContent = '';
    let fileExists = false;
    try {
      currentContent = await this.config
        .getFileSystemService()
        .readTextFile(filePath);
      // Normalize line endings
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      const nodeError = err as { code?: string };
      if (nodeError.code !== 'ENOENT') {
        throw err;
      }
      // File doesn't exist - will be created
    }

    // Parse patch
    let patches: Diff.StructuredPatch[];
    try {
      patches = Diff.parsePatch(this.params.patch_content);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Failed to parse patch: ${errorMsg}`,
        returnDisplay: `Error parsing patch: ${errorMsg}`,
        error: {
          message: `Failed to parse patch: ${errorMsg}`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Classify operations to determine content writes
    const classification = classifyPatchOperations(patches);

    // Apply patch - diff.applyPatch accepts string | StructuredPatch | [StructuredPatch]
    // parsePatch returns StructuredPatch[], so pass the first patch (single-file)
    let newContent: string;
    try {
      const newContentResult = Diff.applyPatch(currentContent, patches[0]);
      if (typeof newContentResult !== 'string') {
        throw new Error('Failed to apply patch: could not apply');
      }
      newContent = newContentResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Failed to apply patch: ${errorMsg}`,
        returnDisplay: `Error applying patch: ${errorMsg}`,
        error: {
          message: `Failed to apply patch: ${errorMsg}`,
          type: ToolErrorType.EDIT_NO_CHANGE,
        },
      };
    }

    // Write new content
    try {
      await this.config
        .getFileSystemService()
        .writeTextFile(filePath, newContent);

      // Track git stats if logging is enabled and service is available
      let gitStats = null;
      if (this.config.getConversationLoggingEnabled()) {
        const gitStatsService = getGitStatsService();
        if (gitStatsService) {
          try {
            gitStats = await gitStatsService.trackFileEdit(
              filePath,
              currentContent,
              newContent,
            );
          } catch (error) {
            // Don't fail the patch if git stats tracking fails
            console.warn('Failed to track git stats:', error);
          }
        }
      }

      const fileName = path.basename(filePath);
      const originallyProposedContent =
        this.params.ai_proposed_content || newContent;
      const diffStat = getDiffStat(
        fileName,
        currentContent,
        originallyProposedContent,
        newContent,
      );

      const fileDiff = Diff.createPatch(
        fileName,
        currentContent,
        newContent,
        'Current',
        'Proposed',
        DEFAULT_CREATE_PATCH_OPTIONS,
      ) as string;

      const displayResult: FileDiff = {
        fileDiff,
        fileName,
        originalContent: currentContent,
        newContent,
        diffStat,
      };

      const llmSuccessMessageParts = [
        fileExists
          ? `Successfully applied patch to file: ${filePath}.`
          : `Successfully created file from patch: ${filePath}.`,
      ];

      if (this.params.modified_by_user) {
        llmSuccessMessageParts.push(`User modified the patch content.`);
      }

      // @plan PLAN-20250212-LSP.P31
      // @requirement REQ-DIAG-010
      // Append LSP diagnostics after successful patch for content-write files
      try {
        const lspClient = this.config.getLspServiceClient();
        if (lspClient && lspClient.isAlive()) {
          // Only check files that had content writes
          for (const contentFile of classification.contentWriteFiles) {
            // Resolve relative file path from patch to absolute path
            const absoluteFilePath = path.resolve(
              this.config.getTargetDir(),
              contentFile,
            );
            await lspClient.checkFile(absoluteFilePath);
          }

          // Now get diagnostics for the target file
          const diagnostics = await lspClient.checkFile(filePath);
          const lspConfig = this.config.getLspConfig();
          const includeSeverities = lspConfig?.includeSeverities ?? ['error'];
          const filtered = diagnostics.filter((d) =>
            includeSeverities.includes(d.severity),
          );

          if (filtered.length > 0) {
            const maxPerFile = lspConfig?.maxDiagnosticsPerFile ?? 20;
            const relPath = path.relative(this.config.getTargetDir(), filePath);
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
        // LSP failure must never fail the patch (REQ-GRACE-050, REQ-GRACE-055)
        // Silently continue - patch was already successful
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error writing file: ${errorMsg}`,
        returnDisplay: `Error writing file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }
}

/**
 * Implementation of the ApplyPatch tool logic
 */
export class ApplyPatchTool extends BaseDeclarativeTool<
  ApplyPatchToolParams,
  ToolResult
> {
  static readonly Name = APPLY_PATCH_TOOL;

  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      ApplyPatchTool.Name,
      'ApplyPatch',
      `Applies a unified diff format patch to a file. This tool parses the patch content and applies it to the target file.

      The patch_content parameter should contain a valid unified diff patch. The tool will parse, validate, and apply the patch, returning the result.`,
      Kind.Edit,
      {
        properties: {
          absolute_path: {
            description:
              process.platform === 'win32'
                ? "The absolute path to the file to modify (e.g., 'C:\\Users\\project\\file.txt'). Must be an absolute path."
                : "The absolute path to the file to modify (e.g., '/home/user/project/file.txt'). Must start with '/'.",
            type: 'string',
          },
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file to modify.',
            type: 'string',
          },
          patch_content: {
            description:
              'The unified diff format patch content to apply to the file.',
            type: 'string',
          },
        },
        required: ['patch_content'],
        type: 'object',
      },
      true,
      false,
      messageBus,
    );
  }

  /**
   * Validates the parameters for the ApplyPatch tool
   */
  protected override validateToolParamValues(
    params: ApplyPatchToolParams,
  ): string | null {
    // Accept either absolute_path or file_path
    const filePath = params.absolute_path || params.file_path || '';

    if (filePath.trim() === '') {
      return "Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.";
    }

    if (!path.isAbsolute(filePath)) {
      return `File path must be absolute: ${filePath}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(filePath)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    if (!params.patch_content || params.patch_content.trim() === '') {
      return 'patch_content parameter must be provided and non-empty.';
    }

    return null;
  }

  protected createInvocation(
    params: ApplyPatchToolParams,
    messageBus?: MessageBus,
  ): ToolInvocation<ApplyPatchToolParams, ToolResult> {
    // Normalize parameters: if file_path is provided but not absolute_path, copy it over
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new ApplyPatchToolInvocation(
      this.config,
      normalizedParams,
      messageBus,
    );
  }
}
