/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { unescapePath, type ContentBlock } from '@vybestack/llxprt-code-core';
import type { AgentToolHandle } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import {
  buildInitialQueryText,
  processResourceAttachments,
  readFilesAndBuildResult,
  reportIgnoredPaths,
  resolveAtPathCommands,
} from './atCommandProcessorHelpers.js';
import type {
  AtCommandHelperRuntime,
  AtCommandPart,
  AtCommandProcessResult,
} from './atCommandProcessorHelpers.js';
import type {
  McpState,
  StreamRuntime,
  UiSubagentManager,
} from '../cliUiRuntime.js';

export type AtCommandRuntime = AtCommandHelperRuntime &
  Pick<McpState, 'getMcpClientManager' | 'getResourceRegistry'>;

export function buildAtCommandRuntimeFromStream(
  runtime: StreamRuntime,
): AtCommandRuntime {
  return {
    // @plan:ISSUE-2376 — tool lookup is routed through the Agent surface
    // (getToolHandle), so the @-command runtime no longer exposes
    // getToolRegistry; it only carries MCP + file/workspace access.
    getMcpClientManager: () => runtime.mcp.getMcpClientManager(),
    getResourceRegistry: () => runtime.mcp.getResourceRegistry(),
    getFileFilteringOptions: () => runtime.files.getFileFilteringOptions(),
    getWorkspaceContext: () => runtime.files.getWorkspaceContext(),
    getFileService: () => runtime.files.getFileService(),
    getEnableRecursiveFileSearch: () =>
      runtime.files.getEnableRecursiveFileSearch(),
  };
}

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

// The '+' alias only applies when '+' starts a token and is followed by a
// character a path can actually begin with. Rewriting every '+' turned
// ordinary prose ("Ctrl+Q") and box drawing ("+-----") into @-paths, and each
// bogus path triggered a full recursive workspace crawl.
const POWERSHELL_AT_ALIAS = /(^|\s)\+(?=[A-Za-z0-9_./\\~])/g;

/**
 * Applies the PowerShell-only '+' alias for '@'. Exported so the token rules
 * can be exercised directly, independently of the host shell.
 */
export function applyPowerShellAtAlias(query: string): string {
  return query.replace(POWERSHELL_AT_ALIAS, '$1@');
}

interface HandleAtCommandParams {
  query: string;
  config: AtCommandRuntime;
  // @plan:ISSUE-2376 — named-tool lookup via the public Agent surface,
  // replacing direct getToolRegistry().getTool access.
  getToolHandle: (name: string) => AgentToolHandle | undefined;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  messageId: number;
  signal: AbortSignal;
  subagentManager?: UiSubagentManager;
}

type HandleAtCommandResult = AtCommandProcessResult;

const PATH_TERMINATOR = /[,\s;!?()[\]{}]/;
const WHITESPACE = /\s/;

function findNextUnescapedAt(query: string, startIndex: number): number {
  for (let i = startIndex; i < query.length; i++) {
    if (query[i] !== '@') {
      continue;
    }
    // Count consecutive backslashes immediately preceding '@'.
    // Odd count => the '@' is escaped (consumed by a trailing backslash).
    // Even count => the '@' is not escaped (backslashes pair up).
    let backslashCount = 0;
    for (let j = i - 1; j >= 0 && query[j] === '\\'; j--) {
      backslashCount++;
    }
    if (backslashCount % 2 === 0) {
      return i;
    }
  }
  return -1;
}

function isPathTerminatorAt(query: string, index: number): boolean {
  const char = query[index];
  if (PATH_TERMINATOR.test(char)) {
    return true;
  }
  if (char === '.') {
    const nextChar = index + 1 < query.length ? query[index + 1] : '';
    return nextChar === '' || WHITESPACE.test(nextChar);
  }
  return false;
}

function findPathEnd(query: string, startIndex: number): number {
  let pathEndIndex = startIndex;
  let inEscape = false;
  while (pathEndIndex < query.length) {
    const char = query[pathEndIndex];
    if (inEscape) {
      inEscape = false;
    } else if (char === '\\') {
      inEscape = true;
    } else if (isPathTerminatorAt(query, pathEndIndex)) {
      break;
    }
    pathEndIndex++;
  }
  return pathEndIndex;
}

/**
 * Parses a query string to find all '@<path>' commands and text segments.
 * Handles \ escaped spaces within paths.
 * Also supports '+' prefix as alternative to '@' for PowerShell compatibility.
 */
function parseAllAtCommands(query: string): AtCommandPart[] {
  // In PowerShell, also support '+' prefix as alternative to '@'
  // This avoids PowerShell's hashtable completion interference
  if (isPowerShell) {
    query = applyPowerShellAtAlias(query);
  }

  const parts: AtCommandPart[] = [];
  let currentIndex = 0;

  while (currentIndex < query.length) {
    const atIndex = findNextUnescapedAt(query, currentIndex);

    if (atIndex === -1) {
      parts.push({ type: 'text', content: query.substring(currentIndex) });
      break;
    }

    if (atIndex > currentIndex) {
      parts.push({
        type: 'text',
        content: query.substring(currentIndex, atIndex),
      });
    }

    const pathEndIndex = findPathEnd(query, atIndex + 1);
    const rawAtPath = query.substring(atIndex, pathEndIndex);
    const atPath = unescapePath(rawAtPath);
    parts.push({ type: 'atPath', content: atPath });
    currentIndex = pathEndIndex;
  }
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
  getToolHandle,
  addItem,
  onDebugMessage,
  messageId: userMessageTimestamp,
  signal,
  subagentManager,
}: HandleAtCommandParams): Promise<HandleAtCommandResult> {
  showPowerShellTip(query, onDebugMessage);

  const commandParts = parseAllAtCommands(query);
  const atPathCommandParts = commandParts.filter(
    (part) => part.type === 'atPath',
  );
  if (atPathCommandParts.length === 0)
    return { processedQuery: [{ type: 'text', text: query }] };

  const readManyFilesTool = getToolHandle('read_many_files');
  if (!readManyFilesTool) {
    return handleMissingReadManyFilesTool(addItem, userMessageTimestamp);
  }

  const subagentNames = await resolveSubagentNames(
    subagentManager,
    onDebugMessage,
  );

  const resolution = await resolveAtPaths(
    atPathCommandParts,
    config,
    getToolHandle,
    signal,
    onDebugMessage,
    subagentNames,
  );
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
    return handleNoValidPaths(
      query,
      initialQueryText,
      onDebugMessage,
      resolution.selectedSubagents,
    );
  }

  const processedQueryParts = buildProcessedQueryParts(
    initialQueryText,
    resolution.selectedSubagents,
  );
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

async function resolveAtPaths(
  atPathCommandParts: AtCommandPart[],
  config: AtCommandRuntime,
  getToolHandle: (name: string) => AgentToolHandle | undefined,
  signal: AbortSignal,
  onDebugMessage: (message: string) => void,
  subagentNames: readonly string[],
) {
  return resolveAtPathCommands({
    atPathCommandParts,
    config,
    resourceRegistry: config.getResourceRegistry(),
    globTool: getToolHandle('glob'),
    signal,
    onDebugMessage,
    subagentNames,
  });
}

async function resolveSubagentNames(
  subagentManager: UiSubagentManager | undefined,
  onDebugMessage: (message: string) => void,
): Promise<readonly string[]> {
  if (!subagentManager) return [];
  try {
    return await subagentManager.listSubagents();
  } catch (error) {
    onDebugMessage(
      `Warning: failed to list subagents: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function sanitizeSubagentName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function buildSubagentNudge(names: readonly string[]): string {
  const safe = names.map(sanitizeSubagentName);
  return `The user has explicitly selected the following subagent(s): ${safe.join(', ')}. Please use the 'task' tool to delegate to the selected subagent(s).`;
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
  selectedSubagents: readonly string[],
): HandleAtCommandResult {
  onDebugMessage('No valid file paths found in @ commands to read.');
  if (
    (initialQueryText === '@' && query.trim() === '@') ||
    (!initialQueryText && query)
  ) {
    const baseParts: ContentBlock[] = [{ type: 'text', text: query }];
    return { processedQuery: withSubagentNudge(baseParts, selectedSubagents) };
  }
  const baseParts: ContentBlock[] = [
    { type: 'text', text: initialQueryText || query },
  ];
  return {
    processedQuery: withSubagentNudge(baseParts, selectedSubagents),
  };
}

function withSubagentNudge(
  parts: ContentBlock[],
  selectedSubagents: readonly string[],
): ContentBlock[] {
  if (selectedSubagents.length === 0) return parts;
  const nudge: ContentBlock = {
    type: 'text',
    text: buildSubagentNudge(selectedSubagents),
  };
  return [nudge, ...parts];
}

function buildProcessedQueryParts(
  initialQueryText: string,
  selectedSubagents: readonly string[],
): ContentBlock[] {
  const parts: ContentBlock[] = [{ type: 'text', text: initialQueryText }];
  return withSubagentNudge(parts, selectedSubagents);
}
