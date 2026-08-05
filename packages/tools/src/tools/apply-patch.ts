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
  createDefaultToolHost,
  getTargetDirCompat,
  getWorkspaceRootsCompat,
  getLegacyIdeService,
  getLegacyLspService,
} from './edit-utils.js';
import {
  buildApplyThrowResult,
  buildCodexResult,
  buildContextMismatchResult,
  buildDeleteDisplay,
  buildDeletePartialResult,
  buildHeaderlessResult,
  buildMissingFileResult,
  buildMultiSectionResult,
  buildNoHunksResult,
  buildNoSectionsResult,
  buildParseErrorResult,
  buildSuccessParts,
  buildWorkspacePathResult,
  describeHunkCountMismatch,
  hasNoFileHeader,
  isCodexEnvelope,
  isCreationPatch,
  isDeletePatch,
  validatePatchHeader,
} from './apply-patch-analysis.js';

/**
 * Type representing a parsed patch operation
 */
export type PatchOperation = Diff.StructuredPatch;

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
   *
   * Returns `false` for every input `execute` rejects so the caller reaches
   * `execute`, which emits the actionable error. The same predicates and
   * validation helpers `execute` uses are reused here directly (no parallel
   * re-implementation), keeping preview and execution in lockstep.
   */
  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const approvalMode = this.host.getApprovalMode();
    if (approvalMode === 'auto' || approvalMode === 'yolo') {
      return false;
    }

    const filePath = this.getFilePath();

    const parsed = this.parsePatchContent();
    if (!Array.isArray(parsed)) return false;
    const [patch] = parsed;

    if (this.checkPatchHeader(patch) !== null) return false;
    if (
      validatePatchHeader(patch, filePath, getTargetDirCompat(this.host)) !==
      null
    ) {
      return false;
    }

    const { currentContent, fileExists } =
      await this.readCurrentContent(filePath);
    if (!fileExists && !isCreationPatch(patch)) return false;

    const applied = this.applyPatchToContent(currentContent, patch);
    if (typeof applied !== 'string') return false;

    if (isDeletePatch(patch)) {
      return applied === ''
        ? this.buildDeleteConfirmation(filePath, currentContent)
        : false;
    }
    return this.buildEditConfirmation(filePath, currentContent, applied);
  }

  private buildEditConfirmation(
    filePath: string,
    currentContent: string,
    newContent: string,
  ): ToolCallConfirmationDetails {
    const relativePath = makeRelative(filePath, getTargetDirCompat(this.host));
    const fileName = path.basename(filePath);
    // Diff.createPatch always returns a non-empty string (verified for every
    // input including full deletion and empty-to-empty), so there is no falsy
    // state to guard against. The delete helper relies on the same invariant.
    const fileDiff = Diff.createPatch(
      fileName,
      currentContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

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
            // IDE edit flow unsupported for apply_patch
          }
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  /** A delete preview presents the removal (new content empty), not an edit. */
  private buildDeleteConfirmation(
    filePath: string,
    currentContent: string,
  ): ToolCallConfirmationDetails {
    const relativePath = makeRelative(filePath, getTargetDirCompat(this.host));
    const fileName = path.basename(filePath);
    const fileDiff = Diff.createPatch(
      fileName,
      currentContent,
      '',
      'Current',
      'Deleted',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );
    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Delete via Patch: ${shortenPath(relativePath)}`,
      fileName,
      filePath,
      fileDiff,
      originalContent: currentContent,
      newContent: '',
      onConfirm: async () => {},
    };
    return confirmationDetails;
  }

  /**
   * Executes the apply_patch operation
   */
  override async execute(_signal: AbortSignal): Promise<ToolResult> {
    const filePath = this.getFilePath();

    // 1. Validate file path is within workspace.
    const pathError = validatePathWithinWorkspace(
      getWorkspaceRootsCompat(this.host),
      filePath,
    );
    if (pathError) return buildWorkspacePathResult(pathError);

    // 2. Parse patch content (AC5 enriches count-mismatch throws).
    const parsed = this.parsePatchContent();
    if (!Array.isArray(parsed)) return parsed;

    const [patch] = parsed;

    // 4. Header-presence check (AC4) before target validation.
    const headerError = this.checkPatchHeader(patch);
    if (headerError) return headerError;

    // 5. Validate patch header targets this file (AC3).
    const targetError = validatePatchHeader(
      patch,
      filePath,
      getTargetDirCompat(this.host),
    );
    if (targetError) return targetError;

    // 6. Read current content.
    const { currentContent, fileExists } =
      await this.readCurrentContent(filePath);

    // 7. Missing file is not a context mismatch (AC6).
    if (!fileExists && !isCreationPatch(patch)) {
      return buildMissingFileResult(filePath);
    }

    // 8. Apply patch (AC7: single error prefix).
    const applied = this.applyPatchToContent(currentContent, patch);
    if (typeof applied !== 'string') return applied;

    // 9. Delete branch (AC1), else write branch (AC2).
    if (isDeletePatch(patch)) {
      return this.handleDelete(filePath, currentContent, applied);
    }
    return this.writeAndFormatResult(
      filePath,
      currentContent,
      applied,
      fileExists,
      patch,
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

  private async deleteTextFile(filePath: string): Promise<void> {
    const fileSystemService = this.host.getFileSystemService?.();
    if (fileSystemService?.deleteFile !== undefined) {
      await fileSystemService.deleteFile(filePath);
      return;
    }
    // The abstraction's paths are real filesystem paths (AcpFileSystemService
    // itself falls back to a local service for unsupported ops), so unlink
    // targets the right file for every in-tree host when no host delete is
    // supplied.
    await fs.unlink(filePath);
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
      const originalMsg =
        error instanceof Error ? error.message : String(error);
      const enriched =
        describeHunkCountMismatch(this.params.patch_content) ?? originalMsg;
      return buildParseErrorResult(enriched);
    }

    if (patches.length === 0) return buildNoSectionsResult();
    if (patches.length > 1) return buildMultiSectionResult(patches);

    return patches;
  }

  /**
   * AC4: rejects patches with missing or unrecognized headers before target
   * validation. Removes the silent no-op and the "(unknown)" message.
   */
  private checkPatchHeader(patch: Diff.StructuredPatch): ToolResult | null {
    if (patch.hunks.length === 0) {
      return isCodexEnvelope(this.params.patch_content)
        ? buildCodexResult()
        : buildNoHunksResult();
    }
    if (hasNoFileHeader(patch)) {
      const filePath = this.getFilePath();
      return buildHeaderlessResult(
        this.computeRelativePath(filePath),
        path.basename(filePath),
      );
    }
    return null;
  }

  private computeRelativePath(filePath: string): string {
    const toPosix = (p: string): string => p.split(path.sep).join('/');
    return toPosix(path.relative(getTargetDirCompat(this.host), filePath));
  }

  /**
   * AC7: applies the patch. A non-string result returns its ToolResult
   * directly so "Failed to apply patch:" appears exactly once.
   */
  private applyPatchToContent(
    currentContent: string,
    patch: Diff.StructuredPatch,
  ): string | ToolResult {
    try {
      const result = Diff.applyPatch(currentContent, patch);
      return typeof result === 'string' ? result : buildContextMismatchResult();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return buildApplyThrowResult(errorMsg);
    }
  }

  /**
   * AC1: a delete patch must remove the whole file; fail fast otherwise.
   */
  private async handleDelete(
    filePath: string,
    currentContent: string,
    appliedResult: string,
  ): Promise<ToolResult> {
    if (appliedResult !== '') return buildDeletePartialResult(appliedResult);
    try {
      await this.deleteTextFile(filePath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error deleting file: ${errorMsg}`,
        returnDisplay: `Error deleting file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
    const gitStats = await this.trackGitStats(filePath, currentContent, '');
    const result = buildDeleteDisplay(
      path.basename(filePath),
      filePath,
      currentContent,
    );
    if (gitStats !== null) {
      result.metadata = { ...result.metadata, gitStats };
    }
    return result;
  }

  private async writeAndFormatResult(
    filePath: string,
    currentContent: string,
    newContent: string,
    fileExists: boolean,
    patch: Diff.StructuredPatch,
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

      const parts = buildSuccessParts({
        fileExists,
        filePath,
        currentContent,
        newContent,
        patch,
        fileName,
        modifiedByUser: this.params.modified_by_user === true,
      });

      await this.appendLspDiagnostics(filePath, parts);

      const result: ToolResult = {
        llmContent: parts.join('\n\n'),
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
      `Applies a unified diff patch to exactly one target file per call.

      A "---"/"+++" file header is required. For ordinary edits the header path must be the workspace-relative path or the bare file name (a partial path is not accepted); for create and delete patches (using /dev/null) only the basename is matched. Use "--- /dev/null" as the old header to create a file and "+++ /dev/null" as the new header to delete one. In each "@@" hunk the line numbers are tolerant but the old/new line counts are strict. The Codex "*** Begin Patch" envelope is not accepted; provide a standard unified diff.`,
      Kind.Edit,
      {
        properties: {
          absolute_path: {
            description:
              (process.platform === 'win32'
                ? "The absolute path to the file to modify (e.g., 'C:\\Users\\project\\file.txt'). Must be an absolute path. "
                : "The absolute path to the file to modify (e.g., '/home/user/project/file.txt'). Must start with '/'. ") +
              'At least one of absolute_path or file_path is required; absolute_path takes precedence when both are supplied.',
            type: 'string',
          },
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file to modify. At least one of absolute_path or file_path is required; absolute_path takes precedence when both are supplied.',
            type: 'string',
          },
          patch_content: {
            description:
              'The unified diff format patch content to apply to the file.',
            type: 'string',
          },
        },
        required: ['patch_content'],
        anyOf: [{ required: ['absolute_path'] }, { required: ['file_path'] }],
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
