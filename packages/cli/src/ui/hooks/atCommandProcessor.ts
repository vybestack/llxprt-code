/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type { PartUnion } from '@google/genai';
import { unescapePath } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import {
  buildInitialQueryText,
  processResourceAttachments,
  readFilesAndBuildResult,
  reportIgnoredPaths,
  resolveAtPathCommands,
} from './atCommandProcessorHelpers.js';
import type {
  AtCommandPart,
  AtCommandProcessResult,
} from './atCommandProcessorHelpers.js';

// Detect if running in PowerShell to handle @ symbol conflicts
// PowerShell's IntelliSense treats @ as hashtable start and causes severe lag
const isPowerShell = Boolean(
  process.env.PSModulePath !== undefined ||
    process.env.PSVERSION !== undefined ||
    (process.platform === 'win32' &&
      process.env.ComSpec?.toLowerCase().includes('powershell')),
);

// Track if we've shown the PowerShell tip
let powershellTipShown = false;

interface HandleAtCommandParams {
  query: string;
  config: Config;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  messageId: number;
  signal: AbortSignal;
}

type HandleAtCommandResult = AtCommandProcessResult;

/**
 * Parses a query string to find all '@<path>' commands and text segments.
 * Handles \ escaped spaces within paths.
 * Also supports '+' prefix as alternative to '@' for PowerShell compatibility.
 */
function parseAllAtCommands(query: string): AtCommandPart[] {
  // In PowerShell, also support '+' prefix as alternative to '@'
  // This avoids PowerShell's hashtable completion interference
  if (isPowerShell) {
    // Replace '+' with '@' for consistent processing when it's followed by a path
    // We look for + followed by non-whitespace to avoid replacing arithmetic
    query = query.replace(/\+(?=\S)/g, '@');
  }

  const parts: AtCommandPart[] = [];
  let currentIndex = 0;

  while (currentIndex < query.length) {
    let atIndex = -1;
    let nextSearchIndex = currentIndex;
    // Find next unescaped '@'
    while (nextSearchIndex < query.length) {
      if (
        query[nextSearchIndex] === '@' &&
        (nextSearchIndex === 0 || query[nextSearchIndex - 1] !== '\\')
      ) {
        atIndex = nextSearchIndex;
        break;
      }
      nextSearchIndex++;
    }

    if (atIndex === -1) {
      // No more @
      if (currentIndex < query.length) {
        parts.push({ type: 'text', content: query.substring(currentIndex) });
      }
      break;
    }

    // Add text before @
    if (atIndex > currentIndex) {
      parts.push({
        type: 'text',
        content: query.substring(currentIndex, atIndex),
      });
    }

    // Parse @path
    let pathEndIndex = atIndex + 1;
    let inEscape = false;
    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    while (pathEndIndex < query.length) {
      const char = query[pathEndIndex];
      if (inEscape) {
        inEscape = false;
      } else if (char === '\\') {
        inEscape = true;
      } else if (/[,\s;!?()[\]{}]/.test(char)) {
        // Path ends at first whitespace or punctuation not escaped
        break;
      } else if (char === '.') {
        // For . we need to be more careful - only terminate if followed by whitespace or end of string
        // This allows file extensions like .txt, .js but terminates at sentence endings like "file.txt. Next sentence"
        const nextChar =
          pathEndIndex + 1 < query.length ? query[pathEndIndex + 1] : '';
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (nextChar === '' || /\s/.test(nextChar)) {
          break;
        }
      }
      pathEndIndex++;
    }
    const rawAtPath = query.substring(atIndex, pathEndIndex);
    // unescapePath expects the @ symbol to be present, and will handle it.
    const atPath = unescapePath(rawAtPath);
    parts.push({ type: 'atPath', content: atPath });
    currentIndex = pathEndIndex;
  }
  // Filter out empty text parts that might result from consecutive @paths or leading/trailing spaces
  return parts.filter(
    (part) => !(part.type === 'text' && part.content.trim() === ''),
  );
}
/**
 * Processes user input potentially containing one or more '@<path>' commands.
 * If found, it attempts to read the specified files/directories using the
 * 'read_many_files' tool. The user query is modified to include resolved paths,
 * and the content of the files is appended in a structured block.
 *
 * @returns An object indicating whether the main hook should proceed with an
 *          LLM call and the processed query parts (including file content).
 */
export async function handleAtCommand({
  query,
  config,
  addItem,
  onDebugMessage,
  messageId: userMessageTimestamp,
  signal,
}: HandleAtCommandParams): Promise<HandleAtCommandResult> {
  showPowerShellTip(query, onDebugMessage);

  const commandParts = parseAllAtCommands(query);
  const atPathCommandParts = commandParts.filter(
    (part) => part.type === 'atPath',
  );
  if (atPathCommandParts.length === 0)
    return { processedQuery: [{ text: query }] };

  const toolRegistry = config.getToolRegistry();
  const readManyFilesTool = toolRegistry.getTool('read_many_files');
  if (!readManyFilesTool) {
    return handleMissingReadManyFilesTool(addItem, userMessageTimestamp);
  }

  const resolution = await resolveAtPathCommands({
    atPathCommandParts,
    config,
    resourceRegistry: getResourceRegistry(config),
    globTool: toolRegistry.getTool('glob'),
    signal,
    onDebugMessage,
  });
  if (resolution.error) {
    addItem({ type: 'error', text: resolution.error }, userMessageTimestamp);
    return { processedQuery: null, error: resolution.error };
  }

  const initialQueryText = buildInitialQueryText(
    commandParts,
    resolution.atPathToResolvedSpecMap,
  );
  reportIgnoredPaths(resolution.ignoredByReason, onDebugMessage);
  if (
    resolution.pathSpecsToRead.length === 0 &&
    resolution.resourceAttachments.length === 0
  ) {
    return handleNoValidPaths(query, initialQueryText, onDebugMessage);
  }

  const processedQueryParts: PartUnion[] = [{ text: initialQueryText }];
  const resourceResult = await processResourceAttachments({
    resourceAttachments: resolution.resourceAttachments,
    processedQueryParts,
    addItem,
    userMessageTimestamp,
    mcpClientManager: config.getMcpClientManager(),
  });
  if (!Array.isArray(resourceResult)) return resourceResult;

  return readFilesAndBuildResult({
    pathSpecsToRead: resolution.pathSpecsToRead,
    contentLabelsForDisplay: resolution.contentLabelsForDisplay,
    absoluteToRelativePathMap: resolution.absoluteToRelativePathMap,
    processedQueryParts,
    resourceReadDisplays: resourceResult,
    readManyFilesTool,
    respectFileIgnore: config.getFileFilteringOptions(),
    config,
    addItem,
    onDebugMessage,
    userMessageTimestamp,
    signal,
  });
}

function showPowerShellTip(
  query: string,
  onDebugMessage: (message: string) => void,
): void {
  if (!isPowerShell || !query.includes('@') || powershellTipShown) return;
  powershellTipShown = true;
  onDebugMessage(
    'TIP: PowerShell tip: You can use "+" instead of "@" to avoid IntelliSense lag (e.g., +example.txt instead of @example.txt)',
  );
}

function getResourceRegistry(config: Config) {
  return (
    config as Config & {
      getResourceRegistry: () => {
        findResourceByUri: (identifier: string) => unknown;
      };
    }
  ).getResourceRegistry();
}

function handleMissingReadManyFilesTool(
  addItem: UseHistoryManagerReturn['addItem'],
  userMessageTimestamp: number,
): HandleAtCommandResult {
  addItem(
    { type: 'error', text: 'Error: read_many_files tool not found.' },
    userMessageTimestamp,
  );
  return {
    processedQuery: null,
    error: 'Error: read_many_files tool not found.',
  };
}

function handleNoValidPaths(
  query: string,
  initialQueryText: string,
  onDebugMessage: (message: string) => void,
): HandleAtCommandResult {
  onDebugMessage('No valid file paths found in @ commands to read.');
  if (
    (initialQueryText === '@' && query.trim() === '@') ||
    (!initialQueryText && query)
  ) {
    return { processedQuery: [{ text: query }] };
  }
  return { processedQuery: [{ text: initialQueryText || query }] };
}
