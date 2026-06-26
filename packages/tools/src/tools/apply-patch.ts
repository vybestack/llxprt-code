/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @plan PLAN-20250212-LSP.P31 */
/* @requirement REQ-DIAG-010, REQ-DIAG-040, REQ-DIAG-070, REQ-GRACE-050, REQ-GRACE-055 */

import fs from 'node:fs/promises';
import process from 'node:process';
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
import type {
  IIdeService,
  ILspService,
  IToolHost,
  IToolMessageBus,
} from '../interfaces/index.js';
import { ToolErrorType } from '../types/tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import {
  DEFAULT_CREATE_PATCH_OPTIONS,
  getDiffStat,
} from '../utils/diffOptions.js';
import { APPLY_PATCH_TOOL } from '../types/tool-names.js';
import { collectLspDiagnosticsBlock } from '../utils/lsp-diagnostics-helper.js';
import { debugLogger } from '../utils/debugLogger.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';
import {
  getTargetDirCompat,
  getWorkspaceRootsCompat,
  getLegacyIdeService,
  getLegacyLspService,
} from './edit-utils.js';

/**
 * Type representing a parsed patch operation
 */
export type PatchOperation = Diff.StructuredPatch;

function createDefaultToolHost(): IToolHost {
  return {
    getTargetDir: () => process.cwd(),
    getWorkspaceRoots: () => [path.parse(process.cwd()).root],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}

function toIdeConnectionStatus(
  status: unknown,
): 'connected' | 'disconnected' | 'connecting' {
  if (typeof status === 'string') {
    return status === 'connected' || status === 'connecting'
      ? status
      : 'disconnected';
  }
  if (typeof status === 'object' && status !== null && 'status' in status) {
    return toIdeConnectionStatus((status as { status?: unknown }).status);
  }
  return 'disconnected';
}

function isNonNullObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

// Required keys for duck-typing service shapes. Every key must be present
// so partial objects are not misclassified as a given service.
const MESSAGE_BUS_KEYS = ['requestConfirmation'] as const;

const IDE_SERVICE_KEYS = [
  'applyDiff',
  'getConnectionStatus',
  'openDiff',
] as const;

const LSP_SERVICE_KEYS = [
  'waitForDiagnostics',
  'getDiagnostics',
  'getLspConfig',
] as const;

function hasMessageBusShape(value: unknown): value is IToolMessageBus {
  return isNonNullObject(value) && MESSAGE_BUS_KEYS.every((k) => k in value);
}

function hasIdeServiceShape(value: unknown): value is IIdeService {
  return isNonNullObject(value) && IDE_SERVICE_KEYS.every((k) => k in value);
}

function hasLspServiceShape(value: unknown): value is ILspService {
  return isNonNullObject(value) && LSP_SERVICE_KEYS.every((k) => k in value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

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
    private readonly host: IToolHost,
    private readonly ideService: IIdeService | undefined,
    private readonly lspService: ILspService | undefined,
    params: ApplyPatchToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  override getToolName(): string {
    return ApplyPatchTool.Name;
  }

  private getFilePath(): string {
    // Use absolute_path if provided, otherwise fall back to file_path
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
    const relativePath = makeRelative(filePath, getTargetDirCompat(this.host));
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
    const approvalMode = this.host.getApprovalMode();
    if (approvalMode === 'auto' || approvalMode === 'yolo') {
      return false;
    }

    const filePath = this.getFilePath();
    let currentContent = '';

    try {
      currentContent = await this.readTextFile(filePath);
    } catch (err: unknown) {
      // File doesn't exist yet - will be created
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
    }

    // Parse and apply patch to get preview. Use the same validation path as
    // execute so previews match execution behavior.
    const patches = Diff.parsePatch(this.params.patch_content);
    if (patches.length === 0) {
      return false;
    }
    if (patches.length > 1) {
      return false;
    }
    const newContentResult = Diff.applyPatch(currentContent, patches[0]);

    if (typeof newContentResult !== 'string') {
      return false;
    }

    const newContent = newContentResult;

    const relativePath = makeRelative(filePath, getTargetDirCompat(this.host));
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

    const ideConfirmation =
      this.ideService !== undefined &&
      toIdeConnectionStatus(this.ideService.getConnectionStatus()) ===
        'connected'
        ? this.ideService.applyDiff({ filePath, diff: newContent })
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
          this.host.setApprovalMode('auto');
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
    const pathError = validatePathWithinWorkspace(
      getWorkspaceRootsCompat(this.host),
      filePath,
    );
    if (pathError) {
      return {
        llmContent: pathError,
        returnDisplay: 'File path is not within workspace',
        error: {
          message: pathError,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const { currentContent, fileExists } =
      await this.readCurrentContent(filePath);
    const patches = this.parsePatchContent();
    if (!Array.isArray(patches)) return patches;

    const classification = classifyPatchOperations(patches);
    const newContent = this.applyPatch(currentContent, patches);
    if (typeof newContent !== 'string') return newContent;

    return this.writeAndFormatResult(
      filePath,
      currentContent,
      newContent,
      fileExists,
      classification,
    );
  }

  private async readTextFile(filePath: string): Promise<string> {
    const fileSystemService = this.host.getFileSystemService?.();
    if (fileSystemService !== undefined) {
      return fileSystemService.readTextFile(filePath);
    }
    return fs.readFile(filePath, 'utf8');
  }

  private async writeTextFile(
    filePath: string,
    content: string,
  ): Promise<void> {
    const fileSystemService = this.host.getFileSystemService?.();
    if (fileSystemService !== undefined) {
      await fileSystemService.writeTextFile(filePath, content);
      return;
    }
    await fs.writeFile(filePath, content, 'utf8');
  }

  private async readCurrentContent(
    filePath: string,
  ): Promise<{ currentContent: string; fileExists: boolean }> {
    let currentContent = '';
    let fileExists = false;
    try {
      currentContent = await this.readTextFile(filePath);
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
    }
    return { currentContent, fileExists };
  }

  private parsePatchContent(): Diff.StructuredPatch[] | ToolResult {
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

    if (patches.length === 0) {
      return {
        llmContent:
          'Patch content did not contain any parseable file sections. Provide a valid unified diff with at least one file section.',
        returnDisplay: 'No parseable patch sections found.',
        error: {
          message: 'Patch content did not contain any parseable file sections.',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    if (patches.length > 1) {
      const fileNames = patches
        .map((p) => p.newFileName || p.oldFileName)
        .join(', ');
      return {
        llmContent: `apply_patch accepts a single target file patch, but the provided patch_content contained ${patches.length} file sections (${fileNames}). Make a separate apply_patch call for each file.`,
        returnDisplay: `Rejected multi-file patch: ${patches.length} file sections.`,
        error: {
          message: `apply_patch accepts a single target file patch, but the patch_content contained ${patches.length} file sections. Use a separate apply_patch call per file.`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    return patches;
  }

  private applyPatch(
    currentContent: string,
    patches: Diff.StructuredPatch[],
  ): string | ToolResult {
    const [patch] = patches;
    const targetError = this.validatePatchTarget(patch);
    if (targetError) {
      return targetError;
    }

    try {
      const newContentResult = Diff.applyPatch(currentContent, patch);
      if (typeof newContentResult !== 'string') {
        throw new Error('Failed to apply patch: context mismatch');
      }
      return newContentResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Failed to apply patch: ${errorMsg}`,
        returnDisplay: `Error applying patch: ${errorMsg}`,
        error: {
          message: `Failed to apply patch: ${errorMsg}`,
          type: ToolErrorType.PATCH_APPLY_FAILURE,
        },
      };
    }
  }

  /**
   * Validates that the parsed patch header targets the same file as the
   * absolute_path/file_path parameter. Prevents a patch for one file from
   * being silently applied to a different target.
   */
  private validatePatchTarget(patch: Diff.StructuredPatch): ToolResult | null {
    const filePath = this.getFilePath();
    const targetName = path.basename(filePath);

    const stripPrefix = (headerPath: string): string => {
      // Remove a/ or b/ prefixes used in unified diffs.
      if (headerPath.startsWith('a/') || headerPath.startsWith('b/')) {
        return headerPath.slice(2);
      }
      return headerPath;
    };

    const newHeader = stripPrefix(patch.newFileName || '');
    const oldHeader = stripPrefix(patch.oldFileName || '');

    // /dev/null is valid for new-file or delete-style patches.
    const isNewFileFromNull =
      oldHeader === '/dev/null' &&
      newHeader !== '' &&
      newHeader !== '/dev/null';
    const isDeleteToNull =
      newHeader === '/dev/null' &&
      oldHeader !== '' &&
      oldHeader !== '/dev/null';

    if (isNewFileFromNull || isDeleteToNull) {
      // For new-file patches, the new header basename should match target.
      if (isNewFileFromNull && path.basename(newHeader) === targetName) {
        return null;
      }
      // For delete-style patches, the old header basename should match target.
      if (isDeleteToNull && path.basename(oldHeader) === targetName) {
        return null;
      }
    }

    // Unified-diff headers always use forward slashes, but path.relative returns
    // OS-native separators (backslashes on Windows). Normalize both sides to
    // forward slashes so directory-qualified header matching works cross-platform.
    const toPosix = (p: string): string => p.split(path.sep).join('/');
    const relativePath = toPosix(
      path.relative(getTargetDirCompat(this.host), filePath),
    );
    const headerMatches = (header: string): boolean => {
      if (header === '') {
        return false;
      }
      // When the header contains a directory separator, the full relative path
      // must match so that a directory-qualified header (e.g. 'a/src/foo.txt')
      // cannot validate against an absolute_path ending in a different
      // directory's same-named file. Only headers without a directory component
      // fall back to basename comparison.
      if (header.includes('/') || header.includes(path.sep)) {
        return toPosix(header) === relativePath;
      }
      return path.basename(header) === targetName;
    };

    const newMatches = headerMatches(newHeader);
    const oldMatches = headerMatches(oldHeader);

    if (newMatches || oldMatches) {
      return null;
    }

    const describedTarget = newHeader || oldHeader || '(unknown)';
    return {
      llmContent: `Patch header targets "${describedTarget}" but the absolute_path targets "${targetName}". Ensure the patch header matches the target file, or use a separate apply_patch call for "${describedTarget}".`,
      returnDisplay: `Rejected patch: header target "${describedTarget}" does not match absolute_path "${targetName}".`,
      error: {
        message: `Patch header target "${describedTarget}" does not match absolute_path "${targetName}".`,
        type: ToolErrorType.INVALID_TOOL_PARAMS,
      },
    };
  }

  private async writeAndFormatResult(
    filePath: string,
    currentContent: string,
    newContent: string,
    fileExists: boolean,
    classification: { contentWriteFiles: string[] },
  ): Promise<ToolResult> {
    try {
      await this.writeTextFile(filePath, newContent);

      const gitStats = await this.trackGitStats(
        filePath,
        currentContent,
        newContent,
      );
      const fileName = path.basename(filePath);
      const originallyProposedContent = stringOrDefault(
        this.params.ai_proposed_content,
        newContent,
      );
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
      );

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

      if (this.params.modified_by_user === true) {
        llmSuccessMessageParts.push(`User modified the patch content.`);
      }

      await this.appendLspDiagnostics(
        filePath,
        classification,
        llmSuccessMessageParts,
      );

      const result: ToolResult = {
        llmContent: llmSuccessMessageParts.join('\n\n'),
        returnDisplay: displayResult,
      };

      if (gitStats !== null) {
        result.metadata = { ...result.metadata, gitStats };
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

  private async trackGitStats(
    filePath: string,
    currentContent: string,
    newContent: string,
  ): Promise<unknown | null> {
    if (this.host.getConversationLoggingEnabled?.() !== true) return null;
    const gitStatsService = this.host.getGitStatsService?.();
    if (!gitStatsService) return null;
    try {
      return await gitStatsService.trackFileEdit(
        filePath,
        currentContent,
        newContent,
      );
    } catch (error) {
      debugLogger.warn('Failed to track git stats:', error);
      return null;
    }
  }

  // @plan PLAN-20250212-LSP.P31
  // @requirement REQ-DIAG-010
  private async appendLspDiagnostics(
    filePath: string,
    classification: { contentWriteFiles: string[] },
    llmParts: string[],
  ): Promise<void> {
    try {
      if (this.lspService !== undefined) {
        // Wait for diagnostics on the actual file written by the tool
        // (absolute_path), not the patch header path which may differ.
        await this.lspService.waitForDiagnostics(filePath, 5000);
      }

      const diagBlock =
        this.lspService === undefined
          ? null
          : await collectLspDiagnosticsBlock(
              this.lspService,
              this.host,
              filePath,
            );
      if (diagBlock) {
        llmParts.push(diagBlock);
      }
    } catch {
      // LSP failure must never fail the patch (REQ-GRACE-050, REQ-GRACE-055)
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
  private readonly ideService?: IIdeService;
  private readonly lspService?: ILspService;

  constructor(
    private readonly host: IToolHost = createDefaultToolHost(),
    messageBusOrIdeService?: IToolMessageBus | IIdeService,
    ideServiceOrLspService?: IIdeService | ILspService,
    lspService?: ILspService,
  ) {
    const secondArgumentIsMessageBus = hasMessageBusShape(
      messageBusOrIdeService,
    );
    const explicitIdeService = secondArgumentIsMessageBus
      ? ideServiceOrLspService
      : messageBusOrIdeService;
    const ideService = hasIdeServiceShape(explicitIdeService)
      ? explicitIdeService
      : getLegacyIdeService(host);
    const messageBus = secondArgumentIsMessageBus
      ? messageBusOrIdeService
      : undefined;
    const explicitLspService = secondArgumentIsMessageBus
      ? lspService
      : ideServiceOrLspService;
    const resolvedLspService = hasLspServiceShape(explicitLspService)
      ? explicitLspService
      : getLegacyLspService(host);

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
    this.ideService = ideService;
    this.lspService = resolvedLspService;
  }

  /**
   * Validates the parameters for the ApplyPatch tool
   */
  protected override validateToolParamValues(
    params: ApplyPatchToolParams,
  ): string | null {
    // Accept either absolute_path or file_path
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
      getWorkspaceRootsCompat(this.host),
      filePath,
    );
    if (pathError) {
      return pathError;
    }

    if (!params.patch_content || params.patch_content.trim() === '') {
      return 'patch_content parameter must be provided and non-empty.';
    }

    return null;
  }

  protected createInvocation(
    params: ApplyPatchToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<ApplyPatchToolParams, ToolResult> {
    // Normalize parameters: if file_path is provided but not absolute_path, copy it over
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new ApplyPatchToolInvocation(
      this.host,
      this.ideService,
      this.lspService,
      normalizedParams,
      messageBus,
    );
  }
}
