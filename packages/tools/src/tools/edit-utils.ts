/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import process from 'node:process';
import type {
  IIdeService,
  ILspService,
  IToolHost,
  IToolMessageBus,
} from '../interfaces/index.js';
import {
  hasWorkspaceContextCap,
  hasIdeCap,
  hasLspCap,
} from '../interfaces/host-capabilities.js';
import type { ModifyContext } from './modifiable-tool.js';
import { isNodeError } from '../utils/errors.js';
import { EmojiFilter } from '../utils/EmojiFilter.js';
import { ReadFileTool } from './read-file.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { EditToolParams } from './edit.js';
import { fuzzyReplace } from '../utils/fuzzy-replacer.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';

/**
 * Computes the character offset for the start of a 1-based line number
 * within content split by newlines.
 */
function getOffsetForLine(lines: string[], lineNumber: number): number {
  let offset = 0;
  for (let i = 0; i < lineNumber - 1; i++) {
    offset += lines[i].length + 1;
  }
  return offset;
}

/**
 * Counts occurrences of oldString that start within the line range
 * [replaceLine, replaceLine+1) — i.e., occurrences whose start position
 * falls on the specified 1-based line number.
 * Returns 0 if replaceLine is out of range.
 */
export function countLineGuardedOccurrences(
  currentContent: string,
  oldString: string,
  replaceLine: number,
): number {
  if (oldString === '') {
    return 0;
  }
  const lines = currentContent.split('\n');
  if (replaceLine > lines.length) {
    return 0;
  }
  const lineStartOffset = getOffsetForLine(lines, replaceLine);
  const nextLineStartOffset =
    replaceLine < lines.length
      ? getOffsetForLine(lines, replaceLine + 1)
      : currentContent.length;

  let count = 0;
  let searchStart = lineStartOffset;
  while (searchStart < nextLineStartOffset) {
    const foundAt = currentContent.indexOf(oldString, searchStart);
    if (foundAt === -1 || foundAt >= nextLineStartOffset) {
      break;
    }
    count++;
    searchStart = foundAt + oldString.length;
  }
  return count;
}

/**
 * Applies replacement of oldString with newString, but only for occurrences
 * whose start position falls within the line range [replaceLine, replaceLine+1).
 * Replaces up to expectedReplacements eligible occurrences.
 * Returns the resulting content string.
 *
 * Deterministic approach: collect all eligible match offsets from the original
 * content first, then build the output string from original content slices.
 * This avoids the stale-bounds bug that arises when searching a mutated result
 * string with offsets computed from the original content.
 */
export function applyLineGuardedReplacement(
  currentContent: string,
  oldString: string,
  newString: string,
  expectedReplacements: number,
  replaceLine: number,
): string {
  if (oldString === '') {
    return currentContent;
  }
  const lines = currentContent.split('\n');
  if (replaceLine > lines.length) {
    return currentContent;
  }
  const lineStartOffset = getOffsetForLine(lines, replaceLine);
  const nextLineStartOffset =
    replaceLine < lines.length
      ? getOffsetForLine(lines, replaceLine + 1)
      : currentContent.length;

  // Collect eligible match start offsets from the original content.
  const matchOffsets: number[] = [];
  let searchStart = lineStartOffset;
  while (
    matchOffsets.length < expectedReplacements &&
    searchStart < nextLineStartOffset
  ) {
    const foundAt = currentContent.indexOf(oldString, searchStart);
    if (foundAt === -1 || foundAt >= nextLineStartOffset) {
      break;
    }
    matchOffsets.push(foundAt);
    searchStart = foundAt + oldString.length;
  }

  if (matchOffsets.length === 0) {
    return currentContent;
  }

  // Build result from original content slices, replacing at collected offsets.
  let result = '';
  let prevEnd = 0;
  for (const offset of matchOffsets) {
    result += currentContent.substring(prevEnd, offset);
    result += newString;
    prevEnd = offset + oldString.length;
  }
  result += currentContent.substring(prevEnd);
  return result;
}

/**
 * Gets emoji filter instance based on configuration
 */
export function getEmojiFilter(host: IToolHost): EmojiFilter {
  // IToolHost types getEphemeralSettings() as required. Call it directly.
  const settings = host.getEphemeralSettings();
  const mode = settings.emojifilter as 'allowed' | 'auto' | 'warn' | 'error';

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
 * Applies a replacement to content.
 */
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

  if (oldString === '' && expectedReplacements > 1) {
    throw new Error(
      'Cannot perform multiple replacements with empty old_string',
    );
  }

  if (oldString === '') {
    return currentContent;
  }

  const preserveTrailingNewline = currentContent.endsWith('\n');
  const fuzzyResult = fuzzyReplace(
    currentContent,
    oldString,
    newString,
    expectedReplacements > 1,
  );

  if (fuzzyResult && fuzzyResult.occurrences === expectedReplacements) {
    return preserveTrailingNewlineForResult(
      fuzzyResult.result,
      preserveTrailingNewline,
    );
  }

  const result =
    expectedReplacements === 1
      ? replaceSingleOccurrence(currentContent, oldString, newString)
      : replaceExpectedOccurrences(
          currentContent,
          oldString,
          newString,
          expectedReplacements,
        );
  return preserveTrailingNewlineForResult(result, preserveTrailingNewline);
}

function preserveTrailingNewlineForResult(
  result: string,
  preserveTrailingNewline: boolean,
): string {
  if (preserveTrailingNewline && result.length > 0 && !result.endsWith('\n')) {
    return `${result}\n`;
  }
  return result;
}

function replaceSingleOccurrence(
  currentContent: string,
  oldString: string,
  newString: string,
): string {
  // Use a replacer function so `$` in `newString` is treated literally.
  return currentContent.replace(oldString, () => newString);
}

function replaceExpectedOccurrences(
  currentContent: string,
  oldString: string,
  newString: string,
  expectedReplacements: number,
): string {
  let result = currentContent;
  let replacementCount = 0;
  let searchIndex = 0;

  while (replacementCount < expectedReplacements) {
    const foundIndex = result.indexOf(oldString, searchIndex);
    if (foundIndex === -1) {
      break;
    }

    result = replaceAtIndex(result, foundIndex, oldString, newString);
    replacementCount++;
    searchIndex = foundIndex + newString.length;
  }

  return result;
}

function replaceAtIndex(
  content: string,
  foundIndex: number,
  oldString: string,
  newString: string,
): string {
  return (
    content.substring(0, foundIndex) +
    newString +
    content.substring(foundIndex + oldString.length)
  );
}

/**
 * Error information for edit operations.
 */
export interface EditErrorInfo {
  display: string;
  raw: string;
  type: ToolErrorType;
}

/**
 * Builds the error object when zero occurrences are found.
 */
export function buildNoOccurrenceError(
  filteredParams: EditToolParams,
  currentContent: string | null,
  filePath: string,
): EditErrorInfo {
  const replaceLine = filteredParams.replaceBeginLineNumber;

  if (replaceLine !== undefined && replaceLine > 0 && currentContent !== null) {
    const lines = currentContent.split('\n');

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
      display: `Failed to edit: no occurrences of old_string found starting at the specified line ${replaceLine}.`,
      raw: `Failed to edit, 0 occurrences found for old_string starting at line ${replaceLine} in ${filePath}. No edits made. The exact text in old_string was not found starting at that line.\n\n${preview}`,
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
 * Validates the edit parameters after reading file content and builds the
 * appropriate error object if any validation fails.
 */
export function validateEditState(
  filteredParams: EditToolParams,
  currentContent: string | null,
  fileExists: boolean,
  filePath: string,
  occurrences: number,
  expectedReplacements: number,
  finalOldString: string,
  finalNewString: string,
): EditErrorInfo | undefined {
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
    return buildNoOccurrenceError(filteredParams, currentContent, filePath);
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
 * Reads a text file via the host's file-system service when available,
 * falling back to `node:fs/promises` otherwise.
 */
export async function readTextFileViaHost(
  host: IToolHost,
  filePath: string,
): Promise<string> {
  const fileSystemService = host.getFileSystemService?.();
  if (fileSystemService !== undefined) {
    return fileSystemService.readTextFile(filePath);
  }
  // Defer import to keep this module side-effect free for callers that only
  // use the pure helpers above.
  const fs = await import('node:fs/promises');
  return fs.readFile(filePath, 'utf8');
}

function isNonNullObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

const MESSAGE_BUS_KEYS = [
  'requestConfirmation',
  'publishPolicyUpdate',
  'publish',
  'subscribe',
] as const;

const IDE_SERVICE_KEYS = [
  'applyDiff',
  'openDiff',
  'getConnectionStatus',
] as const;

const LSP_SERVICE_KEYS = [
  'waitForDiagnostics',
  'getDiagnostics',
  'getLspConfig',
] as const;

/** Type guard matching objects shaped like {@link IToolMessageBus}. */
export function hasMessageBusShape(value: unknown): value is IToolMessageBus {
  return isNonNullObject(value) && MESSAGE_BUS_KEYS.some((k) => k in value);
}

/** Type guard matching objects shaped like {@link IIdeService}. */
export function hasIdeServiceShape(value: unknown): value is IIdeService {
  return isNonNullObject(value) && IDE_SERVICE_KEYS.some((k) => k in value);
}

/** Type guard matching objects shaped like {@link ILspService}. */
export function hasLspServiceShape(value: unknown): value is ILspService {
  return isNonNullObject(value) && LSP_SERVICE_KEYS.some((k) => k in value);
}

/**
 * Normalizes an opaque IDE connection status value into one of the canonical
 * string states.
 */
export function toIdeConnectionStatus(
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

/** Creates a minimal {@link IToolHost} used as a default argument fallback. */
export function createDefaultToolHost(): IToolHost {
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
      shouldIgnoreFile: () => false,
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

/** Returns the working directory for a host, falling back to cwd. */
export function getTargetDirCompat(host: IToolHost): string {
  return host.getTargetDir();
}

/** Resolves workspace roots from a host with optional legacy accessors. */
export function getWorkspaceRootsCompat(host: IToolHost): string[] {
  if (hasWorkspaceContextCap(host)) {
    const dirs = host.getWorkspaceContext().getDirectories?.();
    if (dirs) {
      return dirs;
    }
  }
  return host.getWorkspaceRoots();
}

type LegacyIdeClient = {
  openDiff?: (
    filePath: string,
    content?: string,
  ) => Promise<{ status: 'accepted' | 'rejected'; content?: string }>;
  getConnectionStatus?: () => unknown;
};

/**
 * Builds an {@link IIdeService} adapter from a host's legacy IDE client when
 * present.
 */
export function getLegacyIdeService(host: IToolHost): IIdeService | undefined {
  if (!hasIdeCap(host)) {
    return undefined;
  }
  const getLegacyIdeClient = (): LegacyIdeClient | undefined => {
    if (host.getIdeMode() !== true) {
      return undefined;
    }
    const ideClient = host.getIdeClient();
    if (
      typeof ideClient !== 'object' ||
      ideClient === null ||
      !('openDiff' in ideClient)
    ) {
      return undefined;
    }
    return ideClient as LegacyIdeClient;
  };
  return {
    applyDiff: async ({ filePath, diff }) => {
      const legacyIdeClient = getLegacyIdeClient();
      if (legacyIdeClient?.openDiff === undefined) {
        return { status: 'rejected', content: undefined };
      }
      const result = await legacyIdeClient.openDiff(filePath, diff);
      return result.status === 'accepted'
        ? { status: 'accepted', content: result.content }
        : { status: 'rejected', content: undefined };
    },
    getConnectionStatus: () =>
      toIdeConnectionStatus(getLegacyIdeClient()?.getConnectionStatus?.()),
    openDiff: async ({ filePath, newContent }) => {
      await getLegacyIdeClient()?.openDiff?.(filePath, newContent);
    },
  };
}

/**
 * Builds an {@link ILspService} adapter from a host's legacy LSP client when
 * present.
 */
export function getLegacyLspService(host: IToolHost): ILspService | undefined {
  if (!hasLspCap(host)) {
    return undefined;
  }
  const lspClient = host.getLspServiceClient();
  if (typeof lspClient !== 'object' || lspClient === null) {
    return undefined;
  }
  return {
    getDiagnostics: () => [],
    waitForDiagnostics: async (filePath, _timeout) => {
      const isAlive = (lspClient as { isAlive?: () => boolean }).isAlive?.();
      if (isAlive !== true) {
        return [];
      }
      const checkFile = (
        lspClient as {
          checkFile?: (
            filePath: string,
            signal?: AbortSignal,
          ) => Promise<unknown>;
        }
      ).checkFile;
      if (typeof checkFile !== 'function') {
        return [];
      }
      const diagnostics = await checkFile.call(lspClient, filePath);
      return Array.isArray(diagnostics) ? diagnostics : [];
    },
    getLspConfig: () => host.getLspConfig?.(),
  };
}

/** Resolves the absolute file path from edit params, preferring absolute_path. */
export function resolveEditFilePath(params: EditToolParams): string {
  return stringOrDefault(
    params.absolute_path,
    stringOrDefault(params.file_path, ''),
  );
}

/**
 * Builds the {@link ModifyContext} used by the Edit tool, parameterized by a
 * `readTextFile` accessor so it can be reused by both the tool and its
 * invocation.
 */
export function createEditModifyContext(
  readTextFile: (filePath: string) => Promise<string>,
): ModifyContext<EditToolParams> {
  return {
    getFilePath: (params: EditToolParams) => resolveEditFilePath(params),
    getCurrentContent: async (params: EditToolParams): Promise<string> => {
      const filePath = resolveEditFilePath(params);
      try {
        return await readTextFile(filePath);
      } catch (err) {
        if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
        return '';
      }
    },
    getProposedContent: async (params: EditToolParams): Promise<string> => {
      const filePath = resolveEditFilePath(params);
      try {
        const raw = await readTextFile(filePath);
        const currentContent = raw.replace(/\r\n/g, '\n');

        const replaceLine = params.replaceBeginLineNumber;

        if (
          replaceLine !== undefined &&
          replaceLine > 0 &&
          params.old_string !== ''
        ) {
          // When replaceBeginLineNumber is set, only replace occurrences
          // whose start falls on the specified line.
          const expectedReplacements = params.expected_replacements ?? 1;
          const eligibleCount = countLineGuardedOccurrences(
            currentContent,
            params.old_string,
            replaceLine,
          );

          // If eligible count doesn't match expected_replacements, execute()
          // would reject with a mismatch error. Return unchanged content to
          // avoid presenting a partial proposal that would never be written.
          if (eligibleCount !== expectedReplacements) {
            return currentContent;
          }

          return applyLineGuardedReplacement(
            currentContent,
            params.old_string,
            params.new_string,
            expectedReplacements,
            replaceLine,
          );
        }

        const isNewFile = params.old_string === '' && currentContent === '';
        return applyReplacement(
          currentContent,
          params.old_string,
          params.new_string,
          isNewFile,
          params.expected_replacements ?? 1,
        );
      } catch (err) {
        if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
        // File does not exist: if old_string is empty, this is a new-file creation.
        if (params.old_string === '') {
          return params.new_string;
        }
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

/** Pure validation of Edit tool parameters against the given workspace roots. */
export function validateEditToolParams(
  params: EditToolParams,
  workspaceRoots: string[],
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

  const pathError = validatePathWithinWorkspace(workspaceRoots, filePath);
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

/**
 * Resolves the overloaded constructor arguments of the Edit tool into the
 * concrete ideService / messageBus / lspService triple.
 */
export function resolveConstructorArguments(
  host: IToolHost,
  messageBusOrIdeService: IToolMessageBus | IIdeService | undefined,
  ideServiceOrLspService: IIdeService | ILspService | undefined,
  lspService: ILspService | undefined,
): {
  ideService: IIdeService | undefined;
  messageBus: IToolMessageBus | undefined;
  resolvedLspService: ILspService | undefined;
} {
  const secondArgumentIsMessageBus = hasMessageBusShape(messageBusOrIdeService);
  const explicitIdeService = secondArgumentIsMessageBus
    ? ideServiceOrLspService
    : messageBusOrIdeService;
  const explicitLspService = secondArgumentIsMessageBus
    ? lspService
    : ideServiceOrLspService;
  return {
    ideService: hasIdeServiceShape(explicitIdeService)
      ? explicitIdeService
      : getLegacyIdeService(host),
    messageBus: secondArgumentIsMessageBus ? messageBusOrIdeService : undefined,
    resolvedLspService: hasLspServiceShape(explicitLspService)
      ? explicitLspService
      : getLegacyLspService(host),
  };
}
