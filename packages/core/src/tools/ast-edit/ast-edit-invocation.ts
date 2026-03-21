/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AST Edit Tool Invocation - Handles execution of edit operations
 */

import * as path from 'path';
import * as Diff from 'diff';
import {
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolEditConfirmationDetails,
  ToolInvocation,
  ToolLocation,
  type ToolResult,
  type FileDiff,
} from '../tools.js';
import { ToolErrorType } from '../tool-error.js';
import { makeRelative, shortenPath } from '../../utils/paths.js';
import { isNodeError } from '../../utils/errors.js';
import { Config, ApprovalMode } from '../../config/config.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from '../diffOptions.js';
import { collectLspDiagnosticsBlock } from '../lsp-diagnostics-helper.js';
import type { AnsiOutput } from '../../utils/terminalSerializer.js';
import { ensureParentDirectoriesExist } from '../ensure-dirs.js';

import type { ASTEditToolParams } from './types.js';
import { ASTConfig } from './ast-config.js';
import { ASTContextCollector } from './context-collector.js';
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
    if (!this.params.force) {
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

    const oldStringSnippet =
      this.params.old_string.split('\n')[0].substring(0, 30) +
      (this.params.old_string.length > 30 ? '...' : '');
    const newStringSnippet =
      this.params.new_string.split('\n')[0].substring(0, 30) +
      (this.params.new_string.length > 30 ? '...' : '');

    if (this.params.old_string === this.params.new_string) {
      return `No file changes to ${shortenPath(relativePath)}`;
    }

    const forceIndicator = this.params.force ? ' [EXECUTE] ' : ' [PREVIEW] ';
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
    if (!this.params.force) {
      return this.executePreview(signal);
    }

    // Step 2: Execution mode (force: true)
    return this.executeApply(signal);
  }

  private async executePreview(_signal: AbortSignal): Promise<ToolResult> {
    try {
      // Read file and collect context
      const rawCurrentContent = await this.readFileContent();
      // Normalize line endings to LF to match apply behavior
      const currentContent = rawCurrentContent.replace(/\r\n/g, '\n');
      // Get timestamp for freshness check
      const currentMtime = await this.getFileLastModified(
        this.params.file_path,
      );

      // Detect if this is a new file (same logic as apply path)
      const isNewFile =
        this.params.old_string === '' && rawCurrentContent === '';

      // Freshness Check (must run first to prevent stale edits in concurrent scenarios)
      if (
        this.params.last_modified &&
        currentMtime &&
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

      const workspaceRoot = this.config.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          currentContent,
          workspaceRoot,
        );

      // Generate preview (use normalized content and correct isNewFile flag)
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

      // Rich preview information
      const fileName = path.basename(this.params.file_path);
      const fileDiff = Diff.createPatch(
        fileName,
        currentContent ?? '',
        newContent,
        'Current',
        'Proposed',
        DEFAULT_CREATE_PATCH_OPTIONS,
      );

      const editPreviewLlmContent = [
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
        enhancedContext.connectedFiles &&
        enhancedContext.connectedFiles.length > 0
          ? [
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
                      (d) =>
                        `  - ${d.type}: ${d.name}${d.signature ? d.signature : ''}`,
                    ),
                  ];
                })
                .flat(),
            ]
          : [],
        astValidation && !astValidation.valid
          ? `- AST errors: ${astValidation.errors.join(', ')}`
          : '',
        currentMtime ? `- Timestamp: ${currentMtime}` : '',
        '',
        'ENHANCED CONTEXT ANALYSIS:',
        ...enhancedContext.declarations.map(
          (decl) => `- ${decl.type}: ${decl.name} (line ${decl.line})`,
        ),
        enhancedContext.relatedSymbols &&
        enhancedContext.relatedSymbols.length > 0
          ? [
              '',
              'RELATED SYMBOLS:',
              ...enhancedContext.relatedSymbols
                .slice(0, ASTConfig.MAX_DISPLAY_RESULTS)
                .map(
                  (symbol) =>
                    `- ${symbol.type}: ${symbol.filePath}:${symbol.line}`,
                ),
            ]
          : [],
        '',
        'NEXT STEP: Call again with force: true to apply changes',
      ]
        .flat()
        .filter(Boolean)
        .join('\n');

      const returnDisplay: FileDiff = {
        fileDiff,
        fileName,
        originalContent: currentContent,
        newContent,
        metadata: {
          astValidation,
          currentMtime,
        },
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

    // Execute actual file write
    try {
      await ensureParentDirectoriesExist(this.params.file_path);
      await this.config
        .getFileSystemService()
        .writeTextFile(this.params.file_path, editData.newContent);

      // Return execution result
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
        metadata: {
          astValidation: editData.astValidation,
        },
      };

      const llmSuccessMessageParts: string[] = [
        `Successfully applied edit to: ${this.params.file_path}`,
        `- Changes: ${editData.occurrences} replacement(s) applied`,
        `- AST validation: ${editData.astValidation?.valid ? 'PASSED' : 'FAILED'}`,
      ];

      // @plan PLAN-20250212-LSP.P31
      // @requirement REQ-DIAG-010
      // Append LSP diagnostics after successful edit
      try {
        const diagBlock = await collectLspDiagnosticsBlock(
          this.config,
          this.params.file_path,
        );
        if (diagBlock) {
          llmSuccessMessageParts.push(diagBlock);
        }
      } catch (_error) {
        // LSP failure must never fail the edit (REQ-GRACE-050, REQ-GRACE-055)
        // Silently continue - edit was already successful
      }

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
