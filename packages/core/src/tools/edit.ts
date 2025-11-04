/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import {
  BaseDeclarativeTool,
  Kind,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolEditConfirmationDetails,
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { isNodeError } from '../utils/errors.js';
import { Config, ApprovalMode } from '../config/config.js';
import { DEFAULT_DIFF_OPTIONS, getDiffStat } from './diffOptions.js';
import { ReadFileTool } from './read-file.js';
import { ModifiableDeclarativeTool, ModifyContext } from './modifiable-tool.js';
import { IDEConnectionStatus } from '../ide/ide-client.js';
import { getGitStatsService } from '../services/git-stats-service.js';
import { EmojiFilter } from '../filters/EmojiFilter.js';
import { fuzzyReplace } from './fuzzy-replacer.js';

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
  // If oldString is empty and it's not a new file, do not modify the content.
  if (oldString === '' && !isNewFile) {
    return currentContent;
  }

  // Prevent infinite loop: empty oldString with multiple replacements is invalid
  if (oldString === '' && expectedReplacements > 1) {
    // This would cause an infinite loop as indexOf("", n) always returns n
    throw new Error(
      'Cannot perform multiple replacements with empty old_string',
    );
  }

  // Try fuzzy matching first
  const fuzzyResult = fuzzyReplace(
    currentContent,
    oldString,
    newString,
    expectedReplacements > 1,
  );

  if (fuzzyResult) {
    // Verify the number of replacements matches expectations
    if (fuzzyResult.occurrences === expectedReplacements) {
      return fuzzyResult.result;
    }
    // If fuzzy matching found a different number of occurrences,
    // fall through to the strict matching below which will properly report the error
  }

  // Fall back to strict matching (original behavior)
  // Use a more precise replacement that only replaces the expected number of occurrences
  if (expectedReplacements === 1) {
    // For single replacement, use replace() instead of replaceAll()
    return currentContent.replace(oldString, newString);
  } else {
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

    return result;
  }
}

/**
 * Parameters for the Edit tool
 */
export interface EditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

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

class EditToolInvocation implements ToolInvocation<EditToolParams, ToolResult> {
  constructor(
    private readonly config: Config,
    public params: EditToolParams,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path }];
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
    let currentContent: string | null = null;
    let fileExists = false;
    let isNewFile = false;
    let finalNewString = filteredParams.new_string;
    let finalOldString = filteredParams.old_string;
    let occurrences = 0;
    let error:
      | { display: string; raw: string; type: ToolErrorType }
      | undefined = undefined;

    try {
      currentContent = await this.config
        .getFileSystemService()
        .readTextFile(params.file_path);
      // Normalize line endings to LF for consistent processing.
      currentContent = currentContent.replace(/\r\n/g, '\n');
      fileExists = true;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        // Rethrow unexpected FS errors (permissions, etc.)
        throw err;
      }
      fileExists = false;
    }

    if (filteredParams.old_string === '' && !fileExists) {
      // Creating a new file
      isNewFile = true;
    } else if (!fileExists) {
      // Trying to edit a nonexistent file (and old_string is not empty)
      error = {
        display: `File not found. Cannot apply edit. Use an empty old_string to create a new file.`,
        raw: `File not found: ${filteredParams.file_path}`,
        type: ToolErrorType.FILE_NOT_FOUND,
      };
    } else if (currentContent !== null) {
      // Editing an existing file - count occurrences
      finalOldString = filteredParams.old_string;
      finalNewString = filteredParams.new_string;

      if (finalOldString === '') {
        occurrences = 0;
      } else {
        // Try fuzzy matching first to count occurrences
        const fuzzyResult = fuzzyReplace(
          currentContent,
          finalOldString,
          finalNewString,
          expectedReplacements > 1,
        );

        if (fuzzyResult) {
          occurrences = fuzzyResult.occurrences;
        } else {
          // Fall back to strict counting
          let count = 0;
          let pos = currentContent.indexOf(finalOldString);
          while (pos !== -1) {
            count++;
            pos = currentContent.indexOf(
              finalOldString,
              pos + finalOldString.length,
            );
          }
          occurrences = count;
        }
      }

      if (filteredParams.old_string === '' && expectedReplacements > 1) {
        // Error: Invalid combination that would cause infinite loop
        error = {
          display: `Failed to edit. Cannot perform multiple replacements with empty old_string.`,
          raw: `Invalid parameters: empty old_string with expected_replacements=${expectedReplacements} would cause infinite loop`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        };
      } else if (filteredParams.old_string === '') {
        // Error: Trying to create a file that already exists
        error = {
          display: `Failed to edit. Attempted to create a file that already exists.`,
          raw: `File already exists, cannot create: ${filteredParams.file_path}`,
          type: ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
        };
      } else if (occurrences === 0) {
        error = {
          display: `Failed to edit, could not find the string to replace.`,
          raw: `Failed to edit, 0 occurrences found for old_string in ${filteredParams.file_path}. No edits made. The exact text in old_string was not found. Ensure you're not escaping content incorrectly and check whitespace, indentation, and context. Use ${ReadFileTool.Name} tool to verify.`,
          type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
        };
      } else if (occurrences !== expectedReplacements) {
        const occurrenceTerm =
          expectedReplacements === 1 ? 'occurrence' : 'occurrences';

        error = {
          display: `Failed to edit, expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences}.`,
          raw: `Failed to edit, Expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences} for old_string in file: ${filteredParams.file_path}`,
          type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
        };
      } else if (finalOldString === finalNewString) {
        error = {
          display: `No changes to apply. The old_string and new_string are identical.`,
          raw: `No changes to apply. The old_string and new_string are identical in file: ${filteredParams.file_path}`,
          type: ToolErrorType.EDIT_NO_CHANGE,
        };
      }
    } else {
      // Should not happen if fileExists and no exception was thrown, but defensively:
      error = {
        display: `Failed to read content of file.`,
        raw: `Failed to read content of existing file: ${filteredParams.file_path}`,
        type: ToolErrorType.READ_CONTENT_FAILURE,
      };
    }

    const newContent = !error
      ? applyReplacement(
          currentContent,
          finalOldString,
          finalNewString,
          isNewFile,
          expectedReplacements,
        )
      : (currentContent ?? '');

    if (!error && fileExists && currentContent === newContent) {
      error = {
        display:
          'No changes to apply. The new content is identical to the current content.',
        raw: `No changes to apply. The new content is identical to the current content in file: ${filteredParams.file_path}`,
        type: ToolErrorType.EDIT_NO_CHANGE,
      };
    }

    return {
      currentContent,
      newContent,
      occurrences,
      error,
      isNewFile,
      filterResult: newStringResult,
    };
  }

  /**
   * Handles the confirmation prompt for the Edit tool in the CLI.
   * It needs to calculate the diff to show the user.
   */
  async shouldConfirmExecute(
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
      console.error('Failed to calculate edit:', error);
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

    const fileName = path.basename(this.params.file_path);
    const fileDiff = Diff.createPatch(
      fileName,
      editData.currentContent ?? '',
      filteredNewContent,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS,
    );
    const ideClient = this.config.getIdeClient();
    const ideConfirmation =
      this.config.getIdeMode() &&
      ideClient?.getConnectionStatus().status === IDEConnectionStatus.Connected
        ? ideClient.openDiff(this.params.file_path, filteredNewContent)
        : undefined;

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(this.params.file_path, this.config.getTargetDir()))}`,
      fileName,
      filePath: this.params.file_path,
      fileDiff,
      originalContent: editData.currentContent,
      newContent: filteredNewContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }

        if (ideConfirmation) {
          const result = await ideConfirmation;
          if (result.status === 'accepted' && result.content) {
            // TODO(chrstn): See https://github.com/google-gemini/gemini-cli/pull/5618#discussion_r2255413084
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
    return `${shortenPath(relativePath)}: ${oldStringSnippet} => ${newStringSnippet}`;
  }

  /**
   * Executes the edit operation with the given parameters.
   * @param params Parameters for the edit operation
   * @returns Result of the edit operation
   */
  async execute(signal: AbortSignal): Promise<ToolResult> {
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

    try {
      await this.ensureParentDirectoriesExist(this.params.file_path);
      await this.config
        .getFileSystemService()
        .writeTextFile(this.params.file_path, editData.newContent);

      // Track git stats if logging is enabled and service is available
      let gitStats = null;
      if (this.config.getConversationLoggingEnabled()) {
        const gitStatsService = getGitStatsService();
        if (gitStatsService) {
          try {
            gitStats = await gitStatsService.trackFileEdit(
              this.params.file_path,
              editData.currentContent || '',
              editData.newContent,
            );
          } catch (error) {
            // Don't fail the edit if git stats tracking fails
            console.warn('Failed to track git stats:', error);
          }
        }
      }

      // Always return diff stats as per upstream
      const fileName = path.basename(this.params.file_path);
      const originallyProposedContent =
        this.params.ai_proposed_content || editData.newContent;
      const diffStat = getDiffStat(
        fileName,
        editData.currentContent ?? '',
        originallyProposedContent,
        editData.newContent,
      );

      const fileDiff = Diff.createPatch(
        fileName,
        editData.currentContent ?? '', // Should not be null here if not isNewFile
        editData.newContent,
        'Current',
        'Proposed',
        DEFAULT_DIFF_OPTIONS,
      );
      const displayResult = {
        fileDiff,
        fileName,
        originalContent: editData.currentContent,
        newContent: editData.newContent,
        diffStat,
      };

      const llmSuccessMessageParts = [
        editData.isNewFile
          ? `Created new file: ${this.params.file_path} with provided content.`
          : `Successfully modified file: ${this.params.file_path} (${editData.occurrences} replacements).`,
      ];
      if (this.params.modified_by_user) {
        llmSuccessMessageParts.push(
          `User modified the \`new_string\` content to be: ${this.params.new_string}.`,
        );
      }

      // Add system feedback for emoji filtering if detected
      if (editData.filterResult?.systemFeedback) {
        llmSuccessMessageParts.push(
          `\n\n<system-reminder>\n${editData.filterResult.systemFeedback}\n</system-reminder>`,
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
   * Creates parent directories if they don't exist
   */
  private async ensureParentDirectoriesExist(filePath: string): Promise<void> {
    const dirName = path.dirname(filePath);
    try {
      await fsPromises.access(dirName);
    } catch {
      await fsPromises.mkdir(dirName, { recursive: true });
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
  static readonly Name = 'replace';
  constructor(private readonly config: Config) {
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
**Important:** If ANY of the above are not satisfied, the tool will fail. CRITICAL for \`old_string\`: Must uniquely identify the single instance to change. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely. If this string matches multiple locations, or does not match exactly, the tool will fail.
**Multiple replacements:** Set \`expected_replacements\` to the number of occurrences you want to replace. The tool will replace ALL occurrences that match \`old_string\` exactly. Ensure the number of replacements matches your expectation.`,
      Kind.Edit,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
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
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: 'object',
      },
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
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(params.file_path)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    // Validate that empty old_string with multiple replacements is not allowed
    const expectedReplacements = params.expected_replacements ?? 1;
    if (params.old_string === '' && expectedReplacements > 1) {
      return `Cannot perform multiple replacements with empty old_string (would cause infinite loop)`;
    }

    return null;
  }

  protected createInvocation(
    params: EditToolParams,
  ): ToolInvocation<EditToolParams, ToolResult> {
    return new EditToolInvocation(this.config, params);
  }

  getModifyContext(_: AbortSignal): ModifyContext<EditToolParams> {
    return {
      getFilePath: (params: EditToolParams) => params.file_path,
      getCurrentContent: async (params: EditToolParams): Promise<string> => {
        try {
          return this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (params: EditToolParams): Promise<string> => {
        try {
          const currentContent = await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
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
