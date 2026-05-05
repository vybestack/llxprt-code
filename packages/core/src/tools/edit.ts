/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

/* @plan PLAN-20250212-LSP.P31 */
/* @requirement REQ-DIAG-010, REQ-GRACE-050, REQ-GRACE-055 */

import * as path from 'path';
import * as Diff from 'diff';
import process from 'node:process';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolEditConfirmationDetails,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import { DEFAULT_CREATE_PATCH_OPTIONS, getDiffStat } from './diffOptions.js';
import { ReadFileTool } from './read-file.js';
import {
  type ModifiableDeclarativeTool,
  type ModifyContext,
} from './modifiable-tool.js';
import { IDEConnectionStatus } from '../ide/ide-client.js';
import { getGitStatsService } from '../services/git-stats-service.js';
import { EmojiFilter } from '../filters/EmojiFilter.js';
import { fuzzyReplace } from './fuzzy-replacer.js';
import { EDIT_TOOL_NAME } from './tool-names.js';
import { collectLspDiagnosticsBlock } from './lsp-diagnostics-helper.js';
import { debugLogger } from '../utils/debugLogger.js';
import { ensureParentDirectoriesExist } from './ensure-dirs.js';
import { validatePathWithinWorkspace } from '../safety/index.js';

/**
 * Gets emoji filter instance based on configuration
 */
function getEmojiFilter(config: Config): EmojiFilter {
  // Get emojifilter from ephemeral settings or default to 'auto'
  const mode = config.getEphemeralSetting('emojifilter') as
    | 'allowed'
    | 'auto'
    | 'warn'
    | 'error';

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

export function applyReplacement(
  currentContent: string | null,
  oldString: string,
  newString: string,
  isNewFile: boolean,
  expectedReplacements: number = 1,
): string {
  if (isNewFile) {
    return newString;
  }
  if (currentContent === null) {
    // Should not happen if not a new file, but defensively return empty or newString if oldString is also empty
    return oldString === '' ? newString : '';
  }

  const preserveTrailingNewline = currentContent.endsWith('\n');
  // Prevent infinite loop: empty oldString with multiple replacements is invalid
  if (oldString === '' && expectedReplacements > 1) {
    // This would cause an infinite loop as indexOf("", n) always returns n
    throw new Error(
      'Cannot perform multiple replacements with empty old_string',
    );
  }

  // If oldString is empty and it's not a new file, do not modify the content.
  if (oldString === '') {
    return currentContent;
  }

  // Try fuzzy matching first
  const fuzzyResult = fuzzyReplace(
    currentContent,
    oldString,
    newString,
    expectedReplacements > 1,
  );

  // Verify the number of replacements matches expectations
  // If fuzzy matching found a different number of occurrences,
  // fall through to the strict matching below which will properly report the error
  if (fuzzyResult && fuzzyResult.occurrences === expectedReplacements) {
    const result = fuzzyResult.result;
    if (
      preserveTrailingNewline &&
      result.length > 0 &&
      !result.endsWith('\n')
    ) {
      return `${result}\n`;
    }
    return result;
  }

  // Fall back to strict matching (original behavior)
  // Use a more precise replacement that only replaces the expected number of occurrences
  if (expectedReplacements === 1) {
    // For single replacement, use replace() instead of replaceAll().
    // Use a replacer function so `$` in `newString` is treated literally.
    const result = currentContent.replace(oldString, () => newString);
    if (
      preserveTrailingNewline &&
      result.length > 0 &&
      !result.endsWith('\n')
    ) {
      return `${result}\n`;
    }
    return result;
  }
  // For multiple replacements, we need to count and limit replacements
  let result = currentContent;
  let replacementCount = 0;
  let searchIndex = 0;

  while (replacementCount < expectedReplacements) {
    const foundIndex = result.indexOf(oldString, searchIndex);
    if (foundIndex === -1) {
      break; // No more occurrences found
    }

    // Replace only this specific occurrence
    result =
      result.substring(0, foundIndex) +
      newString +
      result.substring(foundIndex + oldString.length);

    replacementCount++;
    // Update search index to continue after the replacement
    searchIndex = foundIndex + newString.length;
  }

  if (preserveTrailingNewline && result.length > 0 && !result.endsWith('\n')) {
    return `${result}\n`;
  }
  return result;
}

/**
 * Parameters for the Edit tool
 */
export interface EditToolParams {
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
   * The text to replace
   */
  old_string: string;

  /**
   * The text to replace it with
   */
  new_string: string;

  /**
   * Number of replacements expected. Defaults to 1 if not specified.
   * Use when you want to replace multiple occurrences.
   */
  expected_replacements?: number;

  /**
   * Optional 1-based line number where the replacement should begin.
   * Strongly recommended to always set this to guard against misinterpreting
   * the file structure, especially when similar text appears multiple times.
   */
  replaceBeginLineNumber?: number;

  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;

  /**
   * Initially proposed content.
   */
  ai_proposed_content?: string;
}

interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  occurrences: number;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
  filterResult?: { systemFeedback?: string };
}

class EditToolInvocation extends BaseToolInvocation<
  EditToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: EditToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  override getToolName(): string {
    return EditTool.Name;
  }

  private getFilePath(): string {
    // Use absolute_path if provided, otherwise fall back to file_path
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
    return this.params.absolute_path || this.params.file_path || '';
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.getFilePath() }];
  }

  /**
   * Counts occurrences of oldString in content, trying fuzzy then strict.
   */
  private countOccurrences(
    currentContent: string,
    finalOldString: string,
    finalNewString: string,
    expectedReplacements: number,
    replaceLine: number | undefined,
    filePath: string,
  ): {
    occurrences: number;
    error: { display: string; raw: string; type: ToolErrorType } | undefined;
  } {
    if (finalOldString === '') {
      return { occurrences: 0, error: undefined };
    }

    if (replaceLine !== undefined && replaceLine > 0) {
      const lines = currentContent.split('\n');
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (replaceLine > lines.length) {
        return {
          occurrences: 0,
          error: {
            display: `Failed to edit: replaceBeginLineNumber is out of range.`,
            raw: `Failed to edit: replaceBeginLineNumber=${replaceLine} is out of range for ${filePath} (total lines: ${lines.length}). No edits made.`,
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }
      const lineText = lines[replaceLine - 1];
      let count = 0;
      let pos = lineText.indexOf(finalOldString);
      while (pos !== -1) {
        count++;
        pos = lineText.indexOf(finalOldString, pos + finalOldString.length);
      }
      return { occurrences: count, error: undefined };
    }

    const fuzzyResult = fuzzyReplace(
      currentContent,
      finalOldString,
      finalNewString,
      expectedReplacements > 1,
    );
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (fuzzyResult) {
      return { occurrences: fuzzyResult.occurrences, error: undefined };
    }

    let count = 0;
    let pos = currentContent.indexOf(finalOldString);
    while (pos !== -1) {
      count++;
      pos = currentContent.indexOf(finalOldString, pos + finalOldString.length);
    }
    return { occurrences: count, error: undefined };
  }

  /**
   * Validates the edit parameters after reading file content and builds the
   * appropriate error object if any validation fails.
   */
  private validateEditState(
    filteredParams: EditToolParams,
    currentContent: string | null,
    fileExists: boolean,
    filePath: string,
    occurrences: number,
    expectedReplacements: number,
    finalOldString: string,
    finalNewString: string,
  ): { display: string; raw: string; type: ToolErrorType } | undefined {
    if (filteredParams.old_string === '' && expectedReplacements > 1) {
      return {
        display: `Failed to edit. Cannot perform multiple replacements with empty old_string.`,
        raw: `Invalid parameters: empty old_string with expected_replacements=${expectedReplacements} would cause infinite loop`,
        type: ToolErrorType.INVALID_TOOL_PARAMS,
      };
    }
    if (filteredParams.old_string === '') {
      return {
        display: `Failed to edit. Attempted to create a file that already exists.`,
        raw: `File already exists, cannot create: ${filePath}`,
        type: ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
      };
    }
    if (occurrences === 0) {
      return this.buildNoOccurrenceError(
        filteredParams,
        currentContent,
        filePath,
      );
    }
    if (occurrences !== expectedReplacements) {
      const occurrenceTerm =
        expectedReplacements === 1 ? 'occurrence' : 'occurrences';
      return {
        display: `Failed to edit, expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences}.`,
        raw: `Failed to edit, Expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences} for old_string in file: ${filePath}`,
        type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
      };
    }
    if (finalOldString === finalNewString) {
      return {
        display: `No changes to apply. The old_string and new_string are identical.`,
        raw: `No changes to apply. The old_string and new_string are identical in file: ${filePath}`,
        type: ToolErrorType.EDIT_NO_CHANGE,
      };
    }
    return undefined;
  }

  /**
   * Builds the error object when zero occurrences are found.
   */
  private buildNoOccurrenceError(
    filteredParams: EditToolParams,
    currentContent: string | null,
    filePath: string,
  ): { display: string; raw: string; type: ToolErrorType } {
    const replaceLine = filteredParams.replaceBeginLineNumber;

    if (
      replaceLine !== undefined &&
      replaceLine > 0 &&
      currentContent !== null
    ) {
      const lines = currentContent.split('\n');

      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (replaceLine > lines.length) {
        return {
          display: `Failed to edit: replaceBeginLineNumber is out of range.`,
          raw: `Failed to edit: replaceBeginLineNumber=${replaceLine} is out of range for ${filePath} (total lines: ${lines.length}). No edits made.`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        };
      }

      const lineIndex = replaceLine - 1;
      const startContext = Math.max(0, lineIndex - 2);
      const endContext = Math.min(lines.length - 1, lineIndex + 2);

      let preview = 'Context around requested line:';
      for (let i = startContext; i <= endContext; i++) {
        const lineNumber = i + 1;
        const prefix = lineNumber === replaceLine ? '->' : '  ';
        preview += `\n${prefix} ${lineNumber.toString().padStart(4, ' ')} | ${lines[i]}`;
      }

      return {
        display: `Failed to edit: no occurrences of old_string found on the specified line ${replaceLine}.`,
        raw: `Failed to edit, 0 occurrences found for old_string on line ${replaceLine} in ${filePath}. No edits made. The exact text in old_string was not found on that line.\n\n${preview}`,
        type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
      };
    }

    return {
      display: `Failed to edit, could not find the string to replace.`,
      raw: `Failed to edit, 0 occurrences found for old_string in ${filePath}. No edits made. The exact text in old_string was not found. Ensure you're not escaping content incorrectly and check whitespace, indentation, and context. Use ${ReadFileTool.Name} tool to verify.`,
      type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
    };
  }

  /**
   * Applies the replacement to produce newContent, handling replaceLine.
   */
  private computeNewContent(
    currentContent: string | null,
    fileExists: boolean,
    isNewFile: boolean,
    filteredParams: EditToolParams,
    finalOldString: string,
    finalNewString: string,
    expectedReplacements: number,
    filePath: string,
  ): {
    newContent: string;
    error: { display: string; raw: string; type: ToolErrorType } | undefined;
  } {
    const replaceLine = filteredParams.replaceBeginLineNumber;
    if (
      fileExists &&
      replaceLine !== undefined &&
      replaceLine > 0 &&
      currentContent !== null
    ) {
      const lines = currentContent.split('\n');
      if (replaceLine > lines.length) {
        return {
          newContent: currentContent,
          error: {
            display: `Failed to edit: replaceBeginLineNumber is out of range.`,
            raw: `Failed to edit: replaceBeginLineNumber=${replaceLine} is out of range for ${filePath} (total lines: ${lines.length}). No edits made.`,
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }
      let offset = 0;
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (let i = 0; i < replaceLine - 1; i++) {
        offset += lines[i].length + 1; // +1 for the '\n'
      }
      const lineText = lines[replaceLine - 1];
      const beforeLine = currentContent.substring(0, offset);
      const afterLine = currentContent.substring(offset + lineText.length);

      const updatedLine = applyReplacement(
        lineText,
        finalOldString,
        finalNewString,
        false,
        expectedReplacements,
      );

      return {
        newContent: beforeLine + updatedLine + afterLine,
        error: undefined,
      };
    }

    const newContent = applyReplacement(
      currentContent,
      finalOldString,
      finalNewString,
      isNewFile,
      expectedReplacements,
    );
    return { newContent, error: undefined };
  }

  /**
   * Reads the current file content, handling ENOENT for new files.
   */
  private async readFileState(filePath: string): Promise<{
    currentContent: string | null;
    fileExists: boolean;
  }> {
    try {
      let currentContent = await this.config
        .getFileSystemService()
        .readTextFile(filePath);
      currentContent = currentContent.replace(/\r\n/g, '\n');
      return { currentContent, fileExists: true };
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
      return { currentContent: null, fileExists: false };
    }
  }

  /**
   * Reads file state and validates the edit, returning resolved values.
   */
  private async resolveFileEditState(
    filteredParams: EditToolParams,
    filePath: string,
    expectedReplacements: number,
  ): Promise<{
    currentContent: string | null;
    fileExists: boolean;
    isNewFile: boolean;
    finalOldString: string;
    finalNewString: string;
    occurrences: number;
    error: { display: string; raw: string; type: ToolErrorType } | undefined;
  }> {
    const { currentContent, fileExists } = await this.readFileState(filePath);
    let isNewFile = false;
    const finalOldString = filteredParams.old_string;
    const finalNewString = filteredParams.new_string;
    let occurrences = 0;
    let error:
      | { display: string; raw: string; type: ToolErrorType }
      | undefined = undefined;

    if (filteredParams.old_string === '' && !fileExists) {
      isNewFile = true;
    } else if (!fileExists) {
      error = {
        display: `File not found. Cannot apply edit. Use an empty old_string to create a new file.`,
        raw: `File not found: ${filePath}`,
        type: ToolErrorType.FILE_NOT_FOUND,
      };
    } else if (currentContent !== null) {
      const countResult = this.countOccurrences(
        currentContent,
        finalOldString,
        finalNewString,
        expectedReplacements,
        filteredParams.replaceBeginLineNumber,
        filePath,
      );
      occurrences = countResult.occurrences;
      error = countResult.error;

      error ??= this.validateEditState(
        filteredParams,
        currentContent,
        fileExists,
        filePath,
        occurrences,
        expectedReplacements,
        finalOldString,
        finalNewString,
      );
    } else {
      error = {
        display: `Failed to read content of file.`,
        raw: `Failed to read content of existing file: ${filePath}`,
        type: ToolErrorType.READ_CONTENT_FAILURE,
      };
    }

    return {
      currentContent,
      fileExists,
      isNewFile,
      finalOldString,
      finalNewString,
      occurrences,
      error,
    };
  }

  /**
   * Calculates the potential outcome of an edit operation.
   * @param params Parameters for the edit operation
   * @returns An object describing the potential edit outcome
   * @throws File system errors if reading the file fails unexpectedly (e.g., permissions)
   */
  private async calculateEdit(
    params: EditToolParams,
    _abortSignal: AbortSignal,
  ): Promise<CalculatedEdit> {
    // Apply emoji filtering to edit content
    // NOTE: old_string is NOT filtered because it needs to match existing content exactly
    // Only new_string is filtered to remove emojis from the replacement text
    const filter = getEmojiFilter(this.config);
    const newStringResult = filter.filterFileContent(params.new_string, 'edit');

    // Handle blocking in error mode (only check new_string, not old_string)
    if (newStringResult.blocked) {
      return {
        currentContent: null,
        newContent: '',
        occurrences: 0,
        error: {
          display: 'Cannot edit files with emojis in content',
          raw: 'Emoji filtering blocked the edit operation',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
        isNewFile: false,
        filterResult: newStringResult,
      };
    }

    // Use filtered content for the edit (only filter new_string)
    const filteredParams = {
      ...params,
      new_string: newStringResult.filtered as string,
    };
    const expectedReplacements = filteredParams.expected_replacements ?? 1;

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
    const filePath = params.absolute_path || params.file_path || '';

    const {
      currentContent,
      fileExists,
      isNewFile,
      finalOldString,
      finalNewString,
      occurrences,
      error,
    } = await this.resolveFileEditState(
      filteredParams,
      filePath,
      expectedReplacements,
    );

    let newContent: string;
    let resolvedError = error;
    if (!resolvedError) {
      const contentResult = this.computeNewContent(
        currentContent,
        fileExists,
        isNewFile,
        filteredParams,
        finalOldString,
        finalNewString,
        expectedReplacements,
        filePath,
      );
      newContent = contentResult.newContent;
      resolvedError = contentResult.error;
    } else {
      newContent = currentContent ?? '';
    }

    if (!resolvedError && fileExists && currentContent === newContent) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
      const fp = params.absolute_path || params.file_path || '';
      resolvedError = {
        display:
          'No changes to apply. The new content is identical to the current content.',
        raw: `No changes to apply. The new content is identical to the current content in file: ${fp}`,
        type: ToolErrorType.EDIT_NO_CHANGE,
      };
    }

    return {
      currentContent,
      newContent,
      occurrences,
      error: resolvedError,
      isNewFile,
      filterResult: newStringResult,
    };
  }

  /**
   * Returns confirmation details for this edit operation.
   * Called by getMessageBusDecision before surfacing operations to the policy engine/message bus.
   */
  protected override getConfirmationDetails(): ToolCallConfirmationDetails | null {
    // This is a synchronous method, so we can't calculate the edit here
    // Instead, we'll need to handle confirmation in shouldConfirmExecute, which
    // is invoked when the scheduler needs the diff payload for ASK_USER flows.
    return null;
  }

  /**
   * Handles the confirmation prompt for the Edit tool in the CLI.
   * It needs to calculate the diff to show the user.
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

    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(this.params, abortSignal);
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      debugLogger.log(`Error preparing edit: ${errorMsg}`);
      return false;
    }

    if (editData.error) {
      return false;
    }

    // NOTE: Emoji filtering was already applied to new_string in calculateEdit()
    // We should NOT filter the entire file content here
    const filteredNewContent = editData.newContent;

    // Also filter the original new_string parameter for use in onConfirm
    const filter = getEmojiFilter(this.config);
    const filteredNewStringParam = filter.filterFileContent(
      this.params.new_string,
      'edit',
    );
    const filteredNewString =
      typeof filteredNewStringParam.filtered === 'string'
        ? filteredNewStringParam.filtered
        : this.params.new_string;

    const filePath = this.getFilePath();
    const fileName = path.basename(filePath);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      filteredNewContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );
    const ideClient = this.config.getIdeClient();
    const ideConfirmation =
      this.config.getIdeMode() &&
      ideClient?.getConnectionStatus().status === IDEConnectionStatus.Connected
        ? ideClient.openDiff(filePath, filteredNewContent)
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(filePath, this.config.getTargetDir()))}`,
      fileName,
      filePath,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: filteredNewContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          // No need to publish a policy update as the default policy for
          // AUTO_EDIT already reflects always approving edit.
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        } else {
          await this.publishPolicyUpdate(outcome);
        }

        if (ideConfirmation) {
          const result = await ideConfirmation;
          if (result.status === 'accepted' && result.content) {
            // Task(chrstn): See https://github.com/google-gemini/gemini-cli/pull/5618#discussion_r2255413084
            // for info on a possible race condition where the file is modified on disk while being edited.
            // FIX: IDE confirmation is for visual review only
            // The IDE returns the entire file content, not just the replacement text
            // We should use our original calculated replacement, not the IDE's full file content
            // Otherwise we'd replace a small string with the entire file, causing duplication
            // Use the filtered version of the original new_string parameter
            this.params.new_string = filteredNewString;
          }
        } else {
          // DON'T modify params - they need to stay as the original strings
          // The filtering has already been applied in calculateEdit()
        }
      },
      ideConfirmation,
    };
    return confirmationDetails;
  }

  override getDescription(): string {
    const filePath = this.getFilePath();
    const relativePath = makeRelative(filePath, this.config.getTargetDir());
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
    return `${shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }

  /**
   * Tracks git stats for the edit if logging is enabled.
   */
  private async trackGitStats(
    filePath: string,
    currentContent: string | null,
    newContent: string,
  ): Promise<unknown | null> {
    if (!this.config.getConversationLoggingEnabled()) return null;
    const gitStatsService = getGitStatsService();
    if (!gitStatsService) return null;
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    try {
      return await gitStatsService.trackFileEdit(
        filePath,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: undefined currentContent should default to empty
        currentContent || '',
        newContent,
      );
    } catch (error) {
      debugLogger.warn('Failed to track git stats:', error);
      return null;
    }
  }

  /**
   * Builds the LLM success message parts for a successful edit.
   */
  private buildSuccessMessage(
    editData: CalculatedEdit,
    filePath: string,
  ): string[] {
    const parts = [
      editData.isNewFile
        ? `Created new file: ${filePath} with provided content.`
        : `Successfully modified file: ${filePath} (${editData.occurrences} replacements).`,
    ];
    if (this.params.modified_by_user === true) {
      parts.push(
        `User modified the \`new_string\` content to be: ${this.params.new_string}.`,
      );
    }

    if (editData.filterResult?.systemFeedback) {
      parts.push(
        `\n\n<system-reminder>\n${editData.filterResult.systemFeedback}\n</system-reminder>`,
      );
    }

    return parts;
  }

  /**
   * Appends LSP diagnostics to the message parts.
   */
  private async appendDiagnostics(
    llmParts: string[],
    filePath: string,
  ): Promise<void> {
    try {
      const diagBlock = await collectLspDiagnosticsBlock(this.config, filePath);
      if (diagBlock) {
        llmParts.push(diagBlock);
      }
    } catch {
      // LSP failure must never fail the edit (REQ-GRACE-050, REQ-GRACE-055)
    }
  }

  /**
   * Builds the ToolResult for a successful write, including diff, diagnostics,
   * and optional git-stats metadata.
   */
  private async buildWriteResult(
    editData: CalculatedEdit,
    filePath: string,
  ): Promise<ToolResult> {
    const gitStats = await this.trackGitStats(
      filePath,
      editData.currentContent,
      editData.newContent,
    );

    const fileName = path.basename(filePath);
    const originallyProposedContent =
      this.params.ai_proposed_content ?? editData.newContent;
    const diffStat = getDiffStat(
      fileName,
      editData.currentContent ?? '',
      originallyProposedContent,
      editData.newContent,
    );

    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      editData.newContent,
      'Current',
      'Proposed',
      DEFAULT_CREATE_PATCH_OPTIONS,
    );
    const displayResult = {
      fileDiff,
      fileName,
      filePath: this.params.file_path,
      originalContent: editData.currentContent,
      newContent: editData.newContent,
      diffStat,
      isNewFile: editData.isNewFile,
    };

    const llmSuccessMessageParts = this.buildSuccessMessage(editData, filePath);

    // @plan PLAN-20250212-LSP.P31
    // @requirement REQ-DIAG-010
    await this.appendDiagnostics(llmSuccessMessageParts, filePath);

    const result: ToolResult = {
      llmContent: llmSuccessMessageParts.join('\n\n'),
      returnDisplay: displayResult,
    };

    if (gitStats != null) {
      result.metadata = {
        ...result.metadata,
        gitStats,
      };
    }

    return result;
  }

  /**
   * Executes the edit operation with the given parameters.
   * @param params Parameters for the edit operation
   * @returns Result of the edit operation
   */
  override async execute(signal: AbortSignal): Promise<ToolResult> {
    let editData: CalculatedEdit;
    try {
      editData = await this.calculateEdit(this.params, signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
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

    const filePath = this.getFilePath();
    try {
      await ensureParentDirectoriesExist(filePath);
      await this.config
        .getFileSystemService()
        .writeTextFile(filePath, editData.newContent);

      return await this.buildWriteResult(editData, filePath);
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
}

/**
 * Implementation of the Edit tool logic
 */
export class EditTool
  extends BaseDeclarativeTool<EditToolParams, ToolResult>
  implements ModifiableDeclarativeTool<EditToolParams>
{
  static readonly Name = EDIT_TOOL_NAME;
  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      EditTool.Name,
      'Edit',
      `Replaces text within a file. By default, replaces a single occurrence, but can replace multiple occurrences when \`expected_replacements\` is specified. This tool requires providing significant context around the change to ensure precise targeting. Always use the ${ReadFileTool.Name} tool to examine the file's current content before attempting a text replacement.

      The user has the ability to modify the \`new_string\` content. If modified, this will be stated in the response.

Expectation for required parameters:
1. \`file_path\` MUST be an absolute path; otherwise an error will be thrown.
2. \`old_string\` MUST be the exact literal text to replace (including all whitespace, indentation, newlines, and surrounding code etc.).
3. \`new_string\` MUST be the exact literal text to replace \`old_string\` with (also including all whitespace, indentation, newlines, and surrounding code etc.). Ensure the resulting code is correct and idiomatic.
4. NEVER escape \`old_string\` or \`new_string\`, that would break the exact literal text requirement.
5. If you do not provide \`replaceBeginLineNumber\` and the same text appears multiple times in the file, the tool will return an error instead of applying an ambiguous change.
**Multiple replacements:** Set \`expected_replacements\` to the number of occurrences you want to replace. The tool will replace ALL occurrences that match \`old_string\` exactly. Ensure the number of replacements matches your expectation.`,
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
          old_string: {
            description:
              'The exact literal text to replace, preferably unescaped. For single replacements (default), include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. For multiple replacements, specify expected_replacements parameter. If this string is not the exact literal text (i.e. you escaped it) or does not match exactly, the tool will fail.',
            type: 'string',
          },
          new_string: {
            description:
              'The exact literal text to replace `old_string` with, preferably unescaped. Provide the EXACT text. Ensure the resulting code is correct and idiomatic.',
            type: 'string',
          },
          expected_replacements: {
            type: 'number',
            description:
              'Number of replacements expected. Defaults to 1 if not specified. Use when you want to replace multiple occurrences.',
            minimum: 1,
          },
          replaceBeginLineNumber: {
            type: 'number',
            description:
              'Optional 1-based line number where the replacement should begin. Strongly recommended to always set this to guard against misinterpreting the file structure, especially when similar text appears multiple times.',
            minimum: 1,
          },
        },
        required: ['old_string', 'new_string'],
        type: 'object',
      },
      true,
      false,
      messageBus,
    );
  }

  /**
   * Validates the parameters for the Edit tool
   * @param params Parameters to validate
   * @returns Error message string or null if valid
   */
  protected override validateToolParamValues(
    params: EditToolParams,
  ): string | null {
    // Accept either absolute_path or file_path
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid
    const filePath = params.absolute_path || params.file_path || '';

    if (filePath.trim() === '') {
      return "Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.";
    }

    if (!path.isAbsolute(filePath)) {
      return `File path must be absolute: ${filePath}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    const pathError = validatePathWithinWorkspace(workspaceContext, filePath);
    if (pathError) {
      return pathError;
    }

    // Validate that empty old_string with multiple replacements is not allowed
    const expectedReplacements = params.expected_replacements ?? 1;
    if (params.old_string === '' && expectedReplacements > 1) {
      return `Cannot perform multiple replacements with empty old_string (would cause infinite loop)`;
    }

    const replaceLine = params.replaceBeginLineNumber;
    if (
      replaceLine !== undefined &&
      (!Number.isFinite(replaceLine) ||
        !Number.isInteger(replaceLine) ||
        replaceLine <= 0)
    ) {
      return `replaceBeginLineNumber must be a positive integer (1-based)`;
    }

    return null;
  }

  protected createInvocation(
    params: EditToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ): ToolInvocation<EditToolParams, ToolResult> {
    // Normalize parameters: if file_path is provided but not absolute_path, copy it over
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new EditToolInvocation(
      this.config,
      normalizedParams,
      messageBus,
      toolName ?? this.name,
      displayName ?? this.displayName,
    );
  }

  getModifyContext(_: AbortSignal): ModifyContext<EditToolParams> {
    return {
      getFilePath: (params: EditToolParams) =>
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
        params.absolute_path || params.file_path || '',
      getCurrentContent: async (params: EditToolParams): Promise<string> => {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
        const filePath = params.absolute_path || params.file_path || '';
        try {
          return await this.config
            .getFileSystemService()
            .readTextFile(filePath);
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: EditToolParams): Promise<string> => {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string paths are invalid, fall back to file_path
        const filePath = params.absolute_path || params.file_path || '';
        try {
          const currentContent = await this.config
            .getFileSystemService()
            .readTextFile(filePath);
          return applyReplacement(
            currentContent,
            params.old_string,
            params.new_string,
            params.old_string === '' && currentContent === '',
            params.expected_replacements ?? 1,
          );
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      createUpdatedParams: (
        oldContent: string,
        modifiedProposedContent: string,
        originalParams: EditToolParams,
      ): EditToolParams => ({
        ...originalParams,
        ai_proposed_content: oldContent,
        old_string: oldContent,
        new_string: modifiedProposedContent,
        modified_by_user: true,
      }),
    };
  }
}
