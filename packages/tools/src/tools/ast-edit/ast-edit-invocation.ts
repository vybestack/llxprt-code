/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AST Edit Tool Invocation - Handles execution of edit operations
 */

import * as path from 'path';
import { promises as fsPromises } from 'fs';
import * as Diff from 'diff';
import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolLocation,
} from '../tools.js';
import {
  ToolConfirmationOutcome,
  type ToolEditConfirmationDetails,
  type ToolResult,
  type FileDiff,
} from '../tools.js';
import { ToolErrorType } from '../../types/tool-error.js';
import { makeRelative, shortenPath } from '../../utils/paths.js';
import type {
  Diagnostic,
  IToolHost,
  IIdeService,
  ILspService,
} from '../../interfaces/index.js';
import { toIdeConnectionStatus } from '../edit-utils.js';
import { hasLspCap } from '../../interfaces/host-capabilities.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from '../../utils/diffOptions.js';
import { collectLspDiagnosticsBlock } from '../../utils/lsp-diagnostics-helper.js';
import type { LiveOutputUpdate } from '../../utils/terminalSerializer.js';
import { ensureParentDirectoriesExist } from '../../utils/ensure-dirs.js';

import type { ASTEditToolParams } from './types.js';
import { ASTConfig } from './ast-config.js';
import type { ASTContextCollector } from './context-collector.js';
import {
  calculateEdit,
  validateASTSyntax,
  getFileLastModified,
  type CalculatedEdit,
} from './edit-calculator.js';
import {
  summarizeAstValidation,
  deriveCandidateMapping,
  findEditStartLine,
  formatValidationLineLabel,
  type AstValidationResult,
  type AstValidationSummary,
  type CandidateMapping,
} from './validation-categorizer.js';

function normalizeSeverity(severity: unknown): string {
  if (typeof severity !== 'number') {
    return String(severity ?? 'error');
  }
  return severity === 1 ? 'error' : String(severity);
}

export class ASTEditToolInvocation
  implements ToolInvocation<ASTEditToolParams, ToolResult>
{
  /**
   * When the IDE diff view accepts user-modified content, that full file
   * content overrides the model-computed replacement on write (mirrors
   * write_file). Undefined when there is no IDE confirmation or the user
   * rejected the diff.
   */
  private ideAcceptedContent: string | undefined;

  constructor(
    private readonly host: IToolHost,
    public params: ASTEditToolParams,
    private readonly contextCollector: ASTContextCollector,
    private readonly lspService?: ILspService,
    private readonly ideService?: IIdeService,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path }];
  }

  async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // For preview mode, return false to let execute method handle it
    if (this.params.force !== true) {
      return false;
    }

    // For execution mode, check if confirmation is needed
    const approvalMode = this.host.getApprovalMode();
    if (
      approvalMode === 'auto' ||
      (approvalMode as string) === 'autoEdit' ||
      approvalMode === 'yolo'
    ) {
      return false;
    }

    // Confirmation logic for execution mode
    const editData = await this.calculateEdit(this.params, abortSignal);
    if (editData.error) {
      return false;
    }

    const fileName = path.basename(this.params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      editData.newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );

    const ideConfirmation =
      this.ideService !== undefined &&
      toIdeConnectionStatus(this.ideService.getConnectionStatus()) ===
        'connected'
        ? this.ideService.applyDiff({
            filePath: this.params.file_path,
            diff: editData.newContent,
          })
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(this.params.file_path, this.host.getTargetDir()))}`,
      fileName,
      filePath: this.params.file_path,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.host.setApprovalMode('auto');
        }

        if (ideConfirmation) {
          const result = await ideConfirmation;
          if (result.status === 'accepted' && result.content !== undefined) {
            // The IDE returns the full file content the user reviewed (and
            // possibly edited) in the diff view; write exactly that.
            this.ideAcceptedContent = result.content;
          }
        }
      },
      ideConfirmation,
      metadata: {
        astValidation: editData.astValidation,
        preEditValidation: editData.preEditValidation,
        fileFreshness: editData.fileFreshness,
      },
    };

    return confirmationDetails;
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.host.getTargetDir(),
    );
    if (this.params.old_string === '') {
      return `Create ${shortenPath(relativePath)}`;
    }

    const oldFirstLine = this.params.old_string.split('\n')[0];
    const newFirstLine = this.params.new_string.split('\n')[0];
    const oldStringSnippet =
      oldFirstLine.substring(0, 30) + (oldFirstLine.length > 30 ? '...' : '');
    const newStringSnippet =
      newFirstLine.substring(0, 30) + (newFirstLine.length > 30 ? '...' : '');

    if (this.params.old_string === this.params.new_string) {
      return `No file changes to ${shortenPath(relativePath)}`;
    }

    const forceIndicator =
      this.params.force === true ? ' [EXECUTE] ' : ' [PREVIEW] ';
    return `${forceIndicator}${shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    // Step 1: Preview mode (force: false or unset)
    if (this.params.force !== true) {
      return this.executePreview(signal);
    }

    // Step 2: Execution mode (force: true)
    return this.executeApply(signal);
  }

  private async executePreview(_signal: AbortSignal): Promise<ToolResult> {
    try {
      const editData = await this.calculateEdit(this.params, _signal);
      if (editData.error) {
        return {
          llmContent: editData.error.raw,
          returnDisplay: `Error: ${editData.error.display}`,
          error: {
            message: editData.error.raw,
            type: editData.error.type,
          },
        };
      }

      const currentContent = editData.currentContent ?? '';
      const currentMtime = editData.fileFreshness ?? null;

      const workspaceRoot = this.host.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          currentContent,
          workspaceRoot,
          // REQ-3035-6: previews keep the target file's enhanced context but
          // omit working-set collection/rendering. ast_read_file still collects
          // the working set because it passes no option.
          { collectWorkingSet: false },
        );

      const { astValidation, preEditValidation, mapping } =
        this.computeValidationContext(editData);

      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        currentContent,
        editData.newContent,
        'Current',
        'Proposed',
        DEFAULT_CREATE_PATCH_OPTIONS,
      );

      const editPreviewLlmContent = this.buildPreviewLlmContent(
        enhancedContext,
        astValidation,
        preEditValidation,
        mapping,
        currentMtime,
      );

      const returnDisplay: FileDiff = {
        fileDiff,
        fileName,
        originalContent: currentContent,
        newContent: editData.newContent,
        metadata: { astValidation, preEditValidation, currentMtime },
      };

      return {
        llmContent: editPreviewLlmContent,
        returnDisplay,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing preview: ${errorMsg}`,
        returnDisplay: `Error preparing preview: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }
  }

  private computeValidationContext(editData: CalculatedEdit): {
    astValidation: AstValidationResult;
    preEditValidation: AstValidationResult | undefined;
    mapping: CandidateMapping;
  } {
    const editStartLine = findEditStartLine(
      editData.currentContent,
      this.params.old_string,
    );
    const editRegion =
      editStartLine !== null ? { startLine: editStartLine } : undefined;
    const astValidation =
      editData.astValidation ??
      this.validateASTSyntax(
        this.params.file_path,
        editData.newContent,
        editRegion,
      );
    const preEditValidation: AstValidationResult | undefined =
      editData.preEditValidation ??
      (editData.currentContent !== null
        ? this.validateASTSyntax(this.params.file_path, editData.currentContent)
        : undefined);
    // Derive the mapping from the actual original-to-candidate content diff so
    // shifted pre-existing errors are classified correctly regardless of
    // whether the candidate came from the model or was IDE-edited.
    const mapping = deriveCandidateMapping(
      editData.currentContent,
      editData.newContent,
    );
    return { astValidation, preEditValidation, mapping };
  }

  private buildPreviewLlmContent(
    enhancedContext: Awaited<
      ReturnType<ASTContextCollector['collectEnhancedContext']>
    >,
    astValidation: AstValidationResult,
    preEditValidation: AstValidationResult | undefined,
    mapping: CandidateMapping,
    currentMtime: number | null,
  ): string {
    const summary = summarizeAstValidation(
      preEditValidation,
      astValidation,
      mapping,
    );
    const hasOnlyPreExistingSyntaxErrors = Boolean(
      preEditValidation &&
        !preEditValidation.valid &&
        !astValidation.valid &&
        !summary.newlyIntroduced,
    );
    const preExistingSyntaxErrors = hasOnlyPreExistingSyntaxErrors
      ? `- Pre-existing syntax errors: Yes${formatValidationLineLabel(astValidation.errors)}`
      : '';
    return [
      `LLXPRT EDIT PREVIEW: ${this.params.file_path}`,
      `- Context: ${enhancedContext.language} file with ${enhancedContext.declarations.length} declarations`,
      `- Functions: ${enhancedContext.languageContext.functions.length}`,
      `- Classes: ${enhancedContext.languageContext.classes.length}`,
      `- AST validation: ${summary.label}`,
      preExistingSyntaxErrors,
      !astValidation.valid
        ? `- AST errors: ${astValidation.errors.join(', ')}`
        : '',
      `- Relevant snippets: ${enhancedContext.relevantSnippets.length} found`,
      enhancedContext.repositoryContext
        ? `- Repository: ${enhancedContext.repositoryContext.gitUrl}`
        : '',
      enhancedContext.relatedFiles
        ? `- Related files: ${enhancedContext.relatedFiles.length}`
        : '',
      currentMtime !== null ? `- Timestamp: ${currentMtime}` : '',
      '',
      'ENHANCED CONTEXT ANALYSIS:',
      ...enhancedContext.declarations.map(
        (decl) => `- ${decl.type}: ${decl.name} (line ${decl.line})`,
      ),
      this.formatRelatedSymbols(enhancedContext),
      '',
      'NEXT STEP: Call again with force: true to apply changes',
    ]
      .flat()
      .filter(Boolean)
      .join('\n');
  }

  private formatRelatedSymbols(
    enhancedContext: Awaited<
      ReturnType<ASTContextCollector['collectEnhancedContext']>
    >,
  ): string[] {
    if (
      !enhancedContext.relatedSymbols ||
      enhancedContext.relatedSymbols.length === 0
    ) {
      return [];
    }
    return [
      '',
      'RELATED SYMBOLS:',
      ...enhancedContext.relatedSymbols
        .slice(0, ASTConfig.MAX_DISPLAY_RESULTS)
        .map((symbol) => `- ${symbol.type}: ${symbol.filePath}:${symbol.line}`),
    ];
  }

  private async executeApply(signal: AbortSignal): Promise<ToolResult> {
    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(this.params, signal);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error preparing edit: ${errorMsg}`,
        returnDisplay: `Error preparing edit: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EDIT_PREPARATION_FAILURE,
        },
      };
    }

    if (editData.error) {
      return {
        llmContent: editData.error.raw,
        returnDisplay: `Error: ${editData.error.display}`,
        error: {
          message: editData.error.raw,
          type: editData.error.type,
        },
      };
    }

    return this.writeEditResult(editData);
  }

  private async writeEditResult(editData: CalculatedEdit): Promise<ToolResult> {
    try {
      // When the user accepted (and possibly edited) content in the IDE diff
      // view, that full-file content takes precedence over the model-computed
      // replacement — mirrors write_file/edit behavior.
      const contentToWrite = this.ideAcceptedContent ?? editData.newContent;

      // REQ-3035-2: validate the exact final candidate content before any disk
      // mutation. A newly-introduced syntax error is refused and the file is
      // left byte-for-byte unchanged.
      const { summary, finalValidation, preEditValidation } =
        this.resolveApplyValidation(editData, contentToWrite);
      if (summary.newlyIntroduced) {
        return this.refuseNewlyIntroducedEdit(
          finalValidation.errors.join(', '),
        );
      }

      await ensureParentDirectoriesExist(this.params.file_path);
      await fsPromises.writeFile(
        this.params.file_path,
        contentToWrite,
        'utf-8',
      );

      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        editData.currentContent ?? '',
        contentToWrite,
        'Current',
        'Applied',
        DEFAULT_CREATE_PATCH_OPTIONS,
      );

      const displayResult = {
        fileDiff,
        fileName,
        originalContent: editData.currentContent,
        newContent: contentToWrite,
        applied: true,
        metadata: { astValidation: finalValidation, preEditValidation },
      };

      const llmSuccessMessageParts = this.buildApplySuccessMessage(
        editData,
        summary,
        finalValidation,
        preEditValidation,
      );

      await this.appendLspDiagnostics(llmSuccessMessageParts);

      return {
        llmContent: llmSuccessMessageParts.join('\n\n'),
        returnDisplay: displayResult,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing edit: ${errorMsg}`,
        returnDisplay: `Error writing file: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }

  /**
   * Validates the exact final candidate content and categorizes the result
   * relative to the pre-edit baseline. Reuses the pre-computed validation when
   * the candidate equals the model's replacement; re-validates (with the edit
   * region) when IDE-accepted content diverges.
   *
   * The candidate mapping (unchanged prefix/suffix boundaries) is always
   * derived from the ACTUAL original-to-candidate content diff so shifted
   * pre-existing errors are classified correctly regardless of whether the
   * candidate came from the model or was IDE-edited.
   */
  private resolveApplyValidation(
    editData: CalculatedEdit,
    contentToWrite: string,
  ): {
    summary: AstValidationSummary;
    finalValidation: AstValidationResult;
    preEditValidation: AstValidationResult | undefined;
  } {
    const isModelContent = contentToWrite === editData.newContent;
    // Always derive the mapping from the actual original-to-candidate diff.
    const mapping = deriveCandidateMapping(
      editData.currentContent,
      contentToWrite,
    );
    let editStartLine: number | null;
    if (isModelContent) {
      editStartLine = findEditStartLine(
        editData.currentContent,
        this.params.old_string,
      );
    } else if (
      editData.currentContent !== null &&
      contentToWrite !== editData.currentContent
    ) {
      // IDE-accepted candidate diverges from the original: the edit begins at
      // the first changed line (line 1 when the first line changed), so
      // whole-file recovery locations are refined to the actual edited region.
      // The candidate-diff invariant excludes a no-op revert (candidate equals
      // original) and new files (no original), avoiding the overly broad
      // prefixLines/lineDelta condition that skipped a line-1, zero-delta edit.
      editStartLine = mapping.prefixLines + 1;
    } else {
      editStartLine = null;
    }
    const editRegion =
      editStartLine !== null && editStartLine > 0
        ? { startLine: editStartLine }
        : undefined;
    const finalValidation =
      isModelContent && editData.astValidation
        ? editData.astValidation
        : this.validateASTSyntax(
            this.params.file_path,
            contentToWrite,
            editRegion,
          );
    const preEditValidation = editData.preEditValidation;
    const summary = summarizeAstValidation(
      preEditValidation,
      finalValidation,
      mapping,
    );
    return { summary, finalValidation, preEditValidation };
  }

  private refuseNewlyIntroducedEdit(detail: string): ToolResult {
    const prefix = `Refused edit to ${this.params.file_path}: applying it would introduce an AST syntax error (${detail})`;
    return {
      llmContent: `${prefix}. No changes were written.`,
      returnDisplay: `Edit refused: newly-introduced AST syntax error.`,
      error: {
        message: `${prefix}. Re-read the file, fix the syntax in new_string, then retry.`,
        type: ToolErrorType.AST_SYNTAX_ERROR,
      },
    };
  }

  private buildApplySuccessMessage(
    editData: CalculatedEdit,
    summary: AstValidationSummary,
    finalValidation: AstValidationResult,
    preEditValidation: AstValidationResult | undefined,
  ): string[] {
    const parts: string[] = [
      editData.isNewFile
        ? `Successfully created file: ${this.params.file_path}`
        : `Successfully applied edit to: ${this.params.file_path}`,
    ];
    if (!editData.isNewFile) {
      parts.push(`- Changes: ${editData.occurrences} replacement(s) applied`);
    }
    parts.push(`- AST validation: ${summary.label}`);
    // REQ-3035-4/5: only surface lingering pre-existing errors when the
    // post-edit file is still invalid; a resolved error must not be reported as
    // remaining, and retained pre-existing errors are reported at their CURRENT
    // post-edit coordinates (which may have shifted due to a line-changing edit).
    if (
      preEditValidation &&
      !preEditValidation.valid &&
      !finalValidation.valid
    ) {
      parts.push(
        `- Pre-existing syntax errors: Yes${formatValidationLineLabel(finalValidation.errors)} (not introduced by this edit)`,
      );
    }
    return parts;
  }

  // @plan PLAN-20250212-LSP.P31
  // @requirement REQ-DIAG-010
  private async appendLspDiagnostics(llmParts: string[]): Promise<void> {
    try {
      const lspService = this.getEffectiveLspService();
      if (!lspService) {
        return;
      }
      const diagBlock = await collectLspDiagnosticsBlock(
        lspService,
        this.host,
        this.params.file_path,
      );
      if (diagBlock) {
        llmParts.push(diagBlock);
      }
    } catch {
      // LSP failure must never fail the edit (REQ-GRACE-050, REQ-GRACE-055)
    }
  }

  private getEffectiveLspService(): ILspService | undefined {
    if (this.lspService) {
      return this.lspService;
    }
    if (!hasLspCap(this.host)) {
      return undefined;
    }
    const lspHost = this.host;
    const rawClient = lspHost.getLspServiceClient();
    if (
      typeof rawClient !== 'object' ||
      rawClient === null ||
      (rawClient as { isAlive?: () => boolean }).isAlive?.() !== true
    ) {
      return undefined;
    }
    const client = rawClient as {
      isAlive?: () => boolean;
      getDiagnostics?: (filePath: string) => unknown[];
    };
    return {
      getDiagnostics: (filePath: string) => {
        const diagnostics = client.getDiagnostics?.(filePath) ?? [];
        return diagnostics.map((diagnostic) => {
          const value = diagnostic as {
            message?: string;
            severity?: unknown;
            range?: { start?: { line?: number; character?: number } };
          };
          return {
            message: String(value.message ?? ''),
            severity: normalizeSeverity(value.severity),
            line:
              value.range?.start?.line !== undefined
                ? value.range.start.line + 1
                : undefined,
            column:
              value.range?.start?.character !== undefined
                ? value.range.start.character + 1
                : undefined,
          };
        });
      },
      waitForDiagnostics: async (filePath: string, timeout?: number) => {
        const checker = client as {
          checkFile?: (
            filePath: string,
            signal?: AbortSignal,
          ) => Promise<unknown[]>;
        };
        if (checker.checkFile) {
          const controller = new AbortController();
          const timeoutId =
            timeout !== undefined && timeout !== 0
              ? setTimeout(() => controller.abort(), timeout)
              : undefined;
          try {
            return (await checker.checkFile(filePath, controller.signal)).map(
              (diagnostic) => this.normalizeLegacyDiagnostic(diagnostic),
            );
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }
        }
        return this.getEffectiveLspService()!.getDiagnostics(filePath);
      },
      getLspConfig: () => lspHost.getLspConfig?.(),
    };
  }

  private normalizeLegacyDiagnostic(diagnostic: unknown): Diagnostic {
    const value = diagnostic as {
      message?: string;
      severity?: unknown;
      line?: number;
      column?: number;
      code?: unknown;
      source?: string;
      range?: { start?: { line?: number; character?: number } };
    };
    return {
      message: String(value.message ?? ''),
      severity: normalizeSeverity(value.severity),
      line:
        value.line ??
        (value.range?.start?.line !== undefined
          ? value.range.start.line + 1
          : undefined),
      column:
        value.column ??
        (value.range?.start?.character !== undefined
          ? value.range.start.character + 1
          : undefined),
      code:
        typeof value.code === 'string' || typeof value.code === 'number'
          ? value.code
          : undefined,
      source: value.source,
    };
  }

  protected async calculateEdit(
    params: ASTEditToolParams,
    abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    return calculateEdit(params, this.host, abortSignal);
  }

  private validateASTSyntax(
    filePath: string,
    content: string,
    editRegion?: { startLine: number },
  ): AstValidationResult {
    return validateASTSyntax(filePath, content, editRegion);
  }

  protected async getFileLastModified(
    filePath: string,
  ): Promise<number | null> {
    return getFileLastModified(filePath);
  }
}
