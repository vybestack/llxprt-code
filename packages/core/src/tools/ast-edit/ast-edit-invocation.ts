/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AST Edit Tool Invocation - Handles execution of edit operations
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import * as path from 'path';
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
import { ToolErrorType } from '../tool-error.js';
import { makeRelative, shortenPath } from '../../utils/paths.js';
import { isNodeError } from '../../utils/errors.js';
import type { Config } from '../../config/config.js';
import { ApprovalMode } from '../../config/config.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from '../diffOptions.js';
import { collectLspDiagnosticsBlock } from '../lsp-diagnostics-helper.js';
import type { AnsiOutput } from '../../utils/terminalSerializer.js';
import { ensureParentDirectoriesExist } from '../ensure-dirs.js';

import type { ASTEditToolParams } from './types.js';
import { ASTConfig } from './ast-config.js';
import type { ASTContextCollector } from './context-collector.js';
import { applyReplacement } from './edit-helpers.js';
import {
  calculateEdit,
  validateASTSyntax,
  getFileLastModified,
  type CalculatedEdit,
} from './edit-calculator.js';

export class ASTEditToolInvocation
  implements ToolInvocation<ASTEditToolParams, ToolResult>
{
  constructor(
    private readonly config: Config,
    public params: ASTEditToolParams,
    private readonly contextCollector: ASTContextCollector,
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
    const approvalMode = this.config.getApprovalMode();
    if (
      approvalMode === ApprovalMode.AUTO_EDIT ||
      approvalMode === ApprovalMode.YOLO
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

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(this.params.file_path, this.config.getTargetDir()))}`,
      fileName,
      filePath: this.params.file_path,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
      metadata: {
        astValidation: editData.astValidation,
        fileFreshness: editData.fileFreshness,
      },
    };

    return confirmationDetails;
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.config.getTargetDir(),
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
    _updateOutput?: (output: string | AnsiOutput) => void,
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
      const rawCurrentContent = await this.readFileContent();
      const currentContent = rawCurrentContent.replace(/\r\n/g, '\n');
      const currentMtime = await this.getFileLastModified(
        this.params.file_path,
      );

      const isNewFile = this.detectNewFile(rawCurrentContent, currentMtime);

      const freshnessError = this.checkFreshness(currentMtime);
      if (freshnessError) return freshnessError;

      const workspaceRoot = this.config.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          currentContent,
          workspaceRoot,
        );

      const newContent = applyReplacement(
        currentContent,
        this.params.old_string,
        this.params.new_string,
        isNewFile,
      );
      const astValidation = this.validateASTSyntax(
        this.params.file_path,
        newContent,
      );

      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        currentContent,
        newContent,
        'Current',
        'Proposed',
        DEFAULT_CREATE_PATCH_OPTIONS,
      );

      const editPreviewLlmContent = this.buildPreviewLlmContent(
        enhancedContext,
        astValidation,
        currentMtime,
        workspaceRoot,
      );

      const returnDisplay: FileDiff = {
        fileDiff,
        fileName,
        originalContent: currentContent,
        newContent,
        metadata: { astValidation, currentMtime },
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

  private detectNewFile(
    rawCurrentContent: string,
    mtime: number | null,
  ): boolean {
    if (this.params.old_string === '' && rawCurrentContent === '') {
      return mtime === null;
    }
    return false;
  }

  private checkFreshness(currentMtime: number | null): ToolResult | null {
    if (
      this.params.last_modified !== undefined &&
      currentMtime !== null &&
      currentMtime > this.params.last_modified
    ) {
      const errorMessage = `File ${this.params.file_path} mismatch. Expected mtime <= ${this.params.last_modified}, but found ${currentMtime}.`;
      const displayMessage = `File has been modified since it was last read. Please read the file again to get the latest content.`;
      const rawErrorMessage = JSON.stringify({
        message: errorMessage,
        current_mtime: currentMtime,
        your_mtime: this.params.last_modified,
      });
      return {
        llmContent: rawErrorMessage,
        returnDisplay: `Error: ${displayMessage}`,
        error: {
          message: rawErrorMessage,
          type: ToolErrorType.FILE_MODIFIED_CONFLICT,
        },
      };
    }
    return null;
  }

  private buildPreviewLlmContent(
    enhancedContext: Awaited<
      ReturnType<ASTContextCollector['collectEnhancedContext']>
    >,
    astValidation: { valid: boolean; errors: string[] },
    currentMtime: number | null,
    workspaceRoot: string,
  ): string {
    return [
      `LLXPRT EDIT PREVIEW: ${this.params.file_path}`,
      `- Context: ${enhancedContext.language} file with ${enhancedContext.declarations.length} declarations`,
      `- Functions: ${enhancedContext.languageContext.functions.length}`,
      `- Classes: ${enhancedContext.languageContext.classes.length}`,
      `- AST validation: ${astValidation.valid ? 'PASSED' : 'FAILED'}`,
      `- Relevant snippets: ${enhancedContext.relevantSnippets.length} found`,
      enhancedContext.repositoryContext
        ? `- Repository: ${enhancedContext.repositoryContext.gitUrl}`
        : '',
      enhancedContext.relatedFiles
        ? `- Related files: ${enhancedContext.relatedFiles.length}`
        : '',
      this.formatConnectedFilesContext(enhancedContext, workspaceRoot),
      !astValidation.valid
        ? `- AST errors: ${astValidation.errors.join(', ')}`
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

  private formatConnectedFilesContext(
    enhancedContext: Awaited<
      ReturnType<ASTContextCollector['collectEnhancedContext']>
    >,
    workspaceRoot: string,
  ): string[] {
    if (
      !enhancedContext.connectedFiles ||
      enhancedContext.connectedFiles.length === 0
    ) {
      return [];
    }
    return [
      '',
      'WORKING SET CONTEXT:',
      ...enhancedContext.connectedFiles
        .map((file) => {
          const relPath = makeRelative(file.filePath, workspaceRoot);
          if (file.declarations.length === 0)
            return `- ${relPath} (No declarations)`;
          return [
            `- ${relPath}:`,
            ...file.declarations.map(
              (d) => `  - ${d.type}: ${d.name}${d.signature ?? ''}`,
            ),
          ];
        })
        .flat(),
    ];
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
      await ensureParentDirectoriesExist(this.params.file_path);
      await this.config
        .getFileSystemService()
        .writeTextFile(this.params.file_path, editData.newContent);

      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        editData.currentContent ?? '',
        editData.newContent,
        'Current',
        'Applied',
        DEFAULT_CREATE_PATCH_OPTIONS,
      );

      const displayResult = {
        fileDiff,
        fileName,
        originalContent: editData.currentContent,
        newContent: editData.newContent,
        applied: true,
        metadata: { astValidation: editData.astValidation },
      };

      const llmSuccessMessageParts: string[] = [
        `Successfully applied edit to: ${this.params.file_path}`,
        `- Changes: ${editData.occurrences} replacement(s) applied`,
        `- AST validation: ${editData.astValidation?.valid === true ? 'PASSED' : 'FAILED'}`,
      ];

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

  // @plan PLAN-20250212-LSP.P31
  // @requirement REQ-DIAG-010
  private async appendLspDiagnostics(llmParts: string[]): Promise<void> {
    try {
      const diagBlock = await collectLspDiagnosticsBlock(
        this.config,
        this.params.file_path,
      );
      if (diagBlock) {
        llmParts.push(diagBlock);
      }
    } catch {
      // LSP failure must never fail the edit (REQ-GRACE-050, REQ-GRACE-055)
    }
  }

  protected async calculateEdit(
    params: ASTEditToolParams,
    abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    return calculateEdit(params, this.config, abortSignal);
  }

  private async readFileContent(): Promise<string> {
    try {
      return await this.config
        .getFileSystemService()
        .readTextFile(this.params.file_path);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private validateASTSyntax(
    filePath: string,
    content: string,
  ): { valid: boolean; errors: string[] } {
    return validateASTSyntax(filePath, content);
  }

  protected async getFileLastModified(
    filePath: string,
  ): Promise<number | null> {
    return getFileLastModified(filePath);
  }
}
