/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileWorkspaceState, ToolRuntime } from '../cliUiRuntime.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { PartListUnion, PartUnion } from '@google/genai';
import {
  debugLogger,
  getErrorMessage,
  isNodeError,
  validatePathWithinWorkspace,
} from '@vybestack/llxprt-code-core';
import type {
  AnyToolInvocation,
  DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import type { IndividualToolCallDisplay } from '../types.js';
import { ToolCallStatus } from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { addToolGroup } from './atCommandResourceHelpers.js';
export { processResourceAttachments } from './atCommandResourceHelpers.js';

export interface AtCommandPart {
  type: 'text' | 'atPath';
  content: string;
}

export interface AtCommandProcessResult {
  processedQuery: PartListUnion | null;
  error?: string;
}

type IgnoredReason = 'git' | 'llxprt' | 'both';

type IgnoredByReason = Record<IgnoredReason, string[]>;

type ResourceRegistry = {
  findResourceByUri: (identifier: string) => DiscoveredMCPResource | undefined;
};

export type AtCommandHelperRuntime = Pick<ToolRuntime, 'getToolRegistry'> &
  Pick<
    FileWorkspaceState,
    | 'getFileFilteringOptions'
    | 'getWorkspaceContext'
    | 'getFileService'
    | 'getEnableRecursiveFileSearch'
  >;

type ToolRegistryTool = ReturnType<
  ReturnType<AtCommandHelperRuntime['getToolRegistry']>['getTool']
>;

interface ResolutionState {
  pathSpecsToRead: string[];
  resourceAttachments: DiscoveredMCPResource[];
  atPathToResolvedSpecMap: Map<string, string>;
  contentLabelsForDisplay: string[];
  absoluteToRelativePathMap: Map<string, string>;
  ignoredByReason: IgnoredByReason;
}

interface ResolveCommandsResult extends ResolutionState {
  error?: string;
}

interface ResolveCommandsParams {
  atPathCommandParts: AtCommandPart[];
  config: AtCommandHelperRuntime;
  resourceRegistry: ResourceRegistry;
  globTool: ToolRegistryTool;
  signal: AbortSignal;
  onDebugMessage: (message: string) => void;
}

interface SingleResolveParams extends ResolveCommandsParams {
  state: ResolutionState;
  originalAtPath: string;
}

interface PathResolution {
  currentPathSpec: string;
  relativePath: string;
}

interface FileReadParams {
  pathSpecsToRead: string[];
  contentLabelsForDisplay: string[];
  absoluteToRelativePathMap: Map<string, string>;
  processedQueryParts: PartUnion[];
  resourceReadDisplays: IndividualToolCallDisplay[];
  readManyFilesTool: NonNullable<ToolRegistryTool>;
  respectFileIgnore: ReturnType<
    AtCommandHelperRuntime['getFileFilteringOptions']
  >;
  config: AtCommandHelperRuntime;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  userMessageTimestamp: number;
  signal: AbortSignal;
}

interface ResolveParams {
  config: AtCommandHelperRuntime;
  globTool: ToolRegistryTool;
  signal: AbortSignal;
  onDebugMessage: (message: string) => void;
}

interface GlobSearchParams {
  globTool: NonNullable<ToolRegistryTool>;
  signal: AbortSignal;
  onDebugMessage: (message: string) => void;
}

export async function resolveAtPathCommands(
  params: ResolveCommandsParams,
): Promise<ResolveCommandsResult> {
  const state = createResolutionState();
  for (const atPathPart of params.atPathCommandParts) {
    const result = await resolveSingleAtCommand({
      ...params,
      state,
      originalAtPath: atPathPart.content,
    });
    if (result !== undefined) return { ...state, error: result };
  }
  return state;
}

function createResolutionState(): ResolutionState {
  return {
    pathSpecsToRead: [],
    resourceAttachments: [],
    atPathToResolvedSpecMap: new Map<string, string>(),
    contentLabelsForDisplay: [],
    absoluteToRelativePathMap: new Map<string, string>(),
    ignoredByReason: { git: [], llxprt: [], both: [] },
  };
}

async function resolveSingleAtCommand({
  originalAtPath,
  state,
  config,
  resourceRegistry,
  globTool,
  signal,
  onDebugMessage,
}: SingleResolveParams): Promise<string | undefined> {
  if (originalAtPath === '@') {
    onDebugMessage(
      'Lone @ detected, will be treated as text in the modified query.',
    );
    return undefined;
  }
  const pathName = originalAtPath.substring(1);
  if (!pathName)
    return `Error: Invalid @ command '${originalAtPath}'. No path specified.`;
  if (recordResourceMatch(resourceRegistry, state, originalAtPath, pathName))
    return undefined;
  const pathError = validatePathWithinWorkspace(
    config.getWorkspaceContext(),
    pathName,
  );
  if (pathError) {
    onDebugMessage(pathError);
    return undefined;
  }
  if (recordIgnoredPath(config, state, pathName, onDebugMessage))
    return undefined;
  await resolveFilePath(
    { config, globTool, signal, onDebugMessage },
    state,
    originalAtPath,
    pathName,
  );
  return undefined;
}

function recordResourceMatch(
  resourceRegistry: ResourceRegistry,
  state: ResolutionState,
  originalAtPath: string,
  pathName: string,
): boolean {
  const resourceMatch = resourceRegistry.findResourceByUri(pathName);
  if (!resourceMatch) return false;
  state.resourceAttachments.push(resourceMatch);
  state.atPathToResolvedSpecMap.set(originalAtPath, pathName);
  return true;
}

function recordIgnoredPath(
  config: AtCommandHelperRuntime,
  state: ResolutionState,
  pathName: string,
  onDebugMessage: (message: string) => void,
): boolean {
  const fileDiscovery = config.getFileService();
  const respectFileIgnore = config.getFileFilteringOptions();
  if (!fileDiscovery.shouldIgnoreFile(pathName, respectFileIgnore))
    return false;

  // The combined check above decides whether to skip; these source-specific
  // checks are only for reporting and intentionally ignore cross-filter negation.
  const gitIgnored =
    respectFileIgnore.respectGitIgnore === true &&
    fileDiscovery.shouldGitIgnoreFile(pathName);
  const llxprtIgnored =
    respectFileIgnore.respectLlxprtIgnore === true &&
    fileDiscovery.shouldLlxprtIgnoreFile(pathName);
  const reason = getIgnoredReason(gitIgnored, llxprtIgnored);
  state.ignoredByReason[reason].push(pathName);
  onDebugMessage(
    `Path ${pathName} is ${getIgnoredReasonText(reason)} and will be skipped.`,
  );
  return true;
}

function getIgnoredReason(
  gitIgnored: boolean,
  llxprtIgnored: boolean,
): IgnoredReason {
  if (gitIgnored && llxprtIgnored) return 'both';
  if (gitIgnored) return 'git';
  if (llxprtIgnored) return 'llxprt';
  throw new Error('Unexpected ignore attribution state');
}

function getIgnoredReasonText(reason: IgnoredReason): string {
  if (reason === 'both') return 'ignored by both git and llxprt';
  if (reason === 'git') return 'git-ignored';
  return 'llxprt-ignored';
}

async function resolveFilePath(
  params: ResolveParams,
  state: ResolutionState,
  originalAtPath: string,
  pathName: string,
): Promise<void> {
  for (const dir of params.config.getWorkspaceContext().getDirectories()) {
    const resolution = await tryResolveInDirectory(
      params,
      dir,
      pathName,
      state,
    );
    if (resolution === undefined) continue;
    state.pathSpecsToRead.push(resolution.currentPathSpec);
    state.atPathToResolvedSpecMap.set(
      originalAtPath,
      resolution.currentPathSpec,
    );
    const displayPath = path.isAbsolute(pathName)
      ? resolution.relativePath
      : pathName;
    state.contentLabelsForDisplay.push(displayPath);
    return;
  }
}

async function tryResolveInDirectory(
  params: ResolveParams,
  dir: string,
  pathName: string,
  state: ResolutionState,
): Promise<PathResolution | undefined> {
  try {
    return await statPathInDirectory(
      params.onDebugMessage,
      dir,
      pathName,
      state,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return searchMissingPath(params, dir, pathName, state);
    }
    debugLogger.error(
      `Error stating path ${pathName}: ${getErrorMessage(error)}`,
    );
    params.onDebugMessage(
      `Error stating path ${pathName}. Path ${pathName} will be skipped.`,
    );
    return undefined;
  }
}

async function statPathInDirectory(
  onDebugMessage: (message: string) => void,
  dir: string,
  pathName: string,
  state: ResolutionState,
): Promise<PathResolution> {
  const absolutePath = path.isAbsolute(pathName)
    ? pathName
    : path.resolve(dir, pathName);
  const stats = await fs.stat(absolutePath);
  const relativePath = path.isAbsolute(pathName)
    ? path.relative(dir, absolutePath)
    : pathName;
  if (stats.isDirectory()) {
    const currentPathSpec = path.join(relativePath, '**');
    onDebugMessage(
      `Path ${pathName} resolved to directory, using glob: ${currentPathSpec}`,
    );
    return { currentPathSpec, relativePath };
  }
  state.absoluteToRelativePathMap.set(absolutePath, relativePath);
  onDebugMessage(
    `Path ${pathName} resolved to file: ${absolutePath}, using relative path: ${relativePath}`,
  );
  return { currentPathSpec: relativePath, relativePath };
}

async function searchMissingPath(
  params: ResolveParams,
  dir: string,
  pathName: string,
  state: ResolutionState,
): Promise<PathResolution | undefined> {
  if (
    params.config.getEnableRecursiveFileSearch() !== true ||
    params.globTool === undefined
  ) {
    params.onDebugMessage(
      'Glob tool not found. Path ' + pathName + ' will be skipped.',
    );
    return undefined;
  }
  params.onDebugMessage(
    `Path ${pathName} not found directly, attempting glob search.`,
  );
  try {
    return await executeGlobSearch(
      {
        globTool: params.globTool,
        signal: params.signal,
        onDebugMessage: params.onDebugMessage,
      },
      dir,
      pathName,
      state,
    );
  } catch (globError) {
    debugLogger.error(
      `Error during glob search for ${pathName}: ${getErrorMessage(globError)}`,
    );
    params.onDebugMessage(
      `Error during glob search for ${pathName}. Path ${pathName} will be skipped.`,
    );
    return undefined;
  }
}

async function executeGlobSearch(
  params: GlobSearchParams,
  dir: string,
  pathName: string,
  state: ResolutionState,
): Promise<PathResolution | undefined> {
  const globResult = await params.globTool.buildAndExecute(
    { pattern: `**/*${pathName}*`, path: dir },
    params.signal,
  );
  if (!isUsableGlobResult(globResult.llmContent)) {
    params.onDebugMessage(
      `Glob search for '**/*${pathName}*' found no files or an error. Path ${pathName} will be skipped.`,
    );
    return undefined;
  }
  const lines = globResult.llmContent.split('\n');
  if (lines.length <= 1 || lines[1] === '') {
    params.onDebugMessage(
      `Glob search for '**/*${pathName}*' did not return a usable path. Path ${pathName} will be skipped.`,
    );
    return undefined;
  }
  const firstMatchAbsolute = lines[1].trim();
  const currentPathSpec = path.relative(dir, firstMatchAbsolute);
  state.absoluteToRelativePathMap.set(firstMatchAbsolute, currentPathSpec);
  params.onDebugMessage(
    `Glob search for ${pathName} found ${firstMatchAbsolute}, using relative path: ${currentPathSpec}`,
  );
  return {
    currentPathSpec,
    relativePath: currentPathSpec,
  };
}

function isUsableGlobResult(llmContent: unknown): llmContent is string {
  return (
    typeof llmContent === 'string' &&
    !llmContent.startsWith('No files found') &&
    !llmContent.startsWith('Error:')
  );
}

export function buildInitialQueryText(
  commandParts: AtCommandPart[],
  atPathToResolvedSpecMap: Map<string, string>,
): string {
  let initialQueryText = '';
  for (let i = 0; i < commandParts.length; i++) {
    initialQueryText = appendCommandPart(
      initialQueryText,
      commandParts,
      i,
      atPathToResolvedSpecMap,
    );
  }
  return initialQueryText.trim();
}

function appendCommandPart(
  initialQueryText: string,
  commandParts: AtCommandPart[],
  index: number,
  atPathToResolvedSpecMap: Map<string, string>,
): string {
  const part = commandParts[index];
  if (part.type === 'text') return initialQueryText + part.content;
  let nextText = initialQueryText;
  if (
    shouldInsertSpaceBeforeAtPath(
      nextText,
      commandParts,
      index,
      atPathToResolvedSpecMap,
    )
  )
    nextText += ' ';
  const resolvedSpec = atPathToResolvedSpecMap.get(part.content);
  if (resolvedSpec) return nextText + `@${resolvedSpec}`;
  if (shouldInsertSpaceBeforeUnresolved(nextText, part, index)) nextText += ' ';
  return nextText + part.content;
}

function shouldInsertSpaceBeforeAtPath(
  text: string,
  commandParts: AtCommandPart[],
  index: number,
  atPathToResolvedSpecMap: Map<string, string>,
): boolean {
  if (index <= 0 || text.length === 0 || text.endsWith(' ')) return false;
  const prevPart = commandParts[index - 1];
  return (
    prevPart.type === 'text' || atPathToResolvedSpecMap.has(prevPart.content)
  );
}

function shouldInsertSpaceBeforeUnresolved(
  text: string,
  part: AtCommandPart,
  index: number,
): boolean {
  return (
    index > 0 &&
    text.length > 0 &&
    !text.endsWith(' ') &&
    !part.content.startsWith(' ')
  );
}

export function reportIgnoredPaths(
  ignoredByReason: IgnoredByReason,
  onDebugMessage: (message: string) => void,
): void {
  const totalIgnored =
    ignoredByReason.git.length +
    ignoredByReason.llxprt.length +
    ignoredByReason.both.length;
  if (totalIgnored === 0) return;
  const messages = buildIgnoredMessages(ignoredByReason);
  const message = `Ignored ${totalIgnored} files:\n${messages.join('\n')}`;
  debugLogger.log(message);
  onDebugMessage(message);
}

function buildIgnoredMessages(ignoredByReason: IgnoredByReason): string[] {
  const messages: string[] = [];
  if (ignoredByReason.git.length > 0)
    messages.push(`Git-ignored: ${ignoredByReason.git.join(', ')}`);
  if (ignoredByReason.llxprt.length > 0)
    messages.push(`Llxprt-ignored: ${ignoredByReason.llxprt.join(', ')}`);
  if (ignoredByReason.both.length > 0)
    messages.push(`Ignored by both: ${ignoredByReason.both.join(', ')}`);
  return messages;
}

export async function readFilesAndBuildResult({
  pathSpecsToRead,
  contentLabelsForDisplay,
  absoluteToRelativePathMap,
  processedQueryParts,
  resourceReadDisplays,
  readManyFilesTool,
  respectFileIgnore,
  config,
  addItem,
  onDebugMessage,
  userMessageTimestamp,
  signal,
}: FileReadParams): Promise<AtCommandProcessResult> {
  if (pathSpecsToRead.length === 0) {
    if (resourceReadDisplays.length > 0)
      addToolGroup(addItem, userMessageTimestamp, resourceReadDisplays);
    return { processedQuery: processedQueryParts };
  }
  let invocation: AnyToolInvocation | undefined;
  try {
    invocation = readManyFilesTool.build(
      buildToolArgs(pathSpecsToRead, respectFileIgnore),
    );
    const result = await invocation.execute(signal);
    const toolCallDisplay = buildReadSuccessDisplay(
      readManyFilesTool,
      invocation,
      result,
      contentLabelsForDisplay,
      userMessageTimestamp,
    );
    appendReadManyFilesContent(
      result.llmContent,
      processedQueryParts,
      absoluteToRelativePathMap,
      config,
      onDebugMessage,
    );
    addToolGroup(addItem, userMessageTimestamp, [
      ...resourceReadDisplays,
      toolCallDisplay,
    ]);
    return { processedQuery: processedQueryParts };
  } catch (error: unknown) {
    const toolCallDisplay = buildReadErrorDisplay(
      readManyFilesTool,
      invocation,
      contentLabelsForDisplay,
      userMessageTimestamp,
      error,
    );
    addToolGroup(addItem, userMessageTimestamp, [
      ...resourceReadDisplays,
      toolCallDisplay,
    ]);
    return {
      processedQuery: null,
      error: `Exiting due to an error processing the @ command: ${toolCallDisplay.resultDisplay}`,
    };
  }
}

function buildToolArgs(
  pathSpecsToRead: string[],
  respectFileIgnore: ReturnType<
    AtCommandHelperRuntime['getFileFilteringOptions']
  >,
) {
  return {
    paths: pathSpecsToRead,
    file_filtering_options: {
      respect_git_ignore: respectFileIgnore.respectGitIgnore,
      respect_llxprt_ignore: respectFileIgnore.respectLlxprtIgnore,
    },
  };
}

function buildReadSuccessDisplay(
  readManyFilesTool: NonNullable<ToolRegistryTool>,
  invocation: AnyToolInvocation,
  result: { returnDisplay?: unknown },
  contentLabelsForDisplay: string[],
  userMessageTimestamp: number,
): IndividualToolCallDisplay {
  return {
    callId: `client-read-${userMessageTimestamp}`,
    name: readManyFilesTool.displayName,
    description: invocation.getDescription(),
    status: ToolCallStatus.Success,
    resultDisplay:
      typeof result.returnDisplay === 'string' && result.returnDisplay
        ? result.returnDisplay
        : `Successfully read: ${contentLabelsForDisplay.join(', ')}`,
    confirmationDetails: undefined,
  };
}

function buildReadErrorDisplay(
  readManyFilesTool: NonNullable<ToolRegistryTool>,
  invocation: AnyToolInvocation | undefined,
  contentLabelsForDisplay: string[],
  userMessageTimestamp: number,
  error: unknown,
): IndividualToolCallDisplay {
  return {
    callId: `client-read-${userMessageTimestamp}`,
    name: readManyFilesTool.displayName,
    description:
      invocation?.getDescription() ??
      'Error attempting to execute tool to read files',
    status: ToolCallStatus.Error,
    resultDisplay: `Error reading files (${contentLabelsForDisplay.join(', ')}): ${getErrorMessage(error)}`,
    confirmationDetails: undefined,
  };
}

function appendReadManyFilesContent(
  llmContent: unknown,
  processedQueryParts: PartUnion[],
  absoluteToRelativePathMap: Map<string, string>,
  config: AtCommandHelperRuntime,
  onDebugMessage: (message: string) => void,
): void {
  if (!Array.isArray(llmContent)) {
    onDebugMessage(
      'read_many_files tool returned no content or empty content.',
    );
    return;
  }
  processedQueryParts.push({ text: '\n--- Content from referenced files ---' });
  for (const part of llmContent)
    processReadManyFilesPart(
      part,
      processedQueryParts,
      absoluteToRelativePathMap,
      config,
    );
}

function processReadManyFilesPart(
  part: unknown,
  processedQueryParts: PartUnion[],
  absoluteToRelativePathMap: Map<string, string>,
  config: AtCommandHelperRuntime,
): void {
  if (typeof part !== 'string') {
    processedQueryParts.push(part as PartUnion);
    return;
  }
  const parsed = parseFileContentPart(part, absoluteToRelativePathMap, config);
  if (parsed === undefined) {
    processedQueryParts.push({ text: part });
    return;
  }
  processedQueryParts.push({
    text: `\nContent from @${parsed.displayPath}:\n`,
  });
  processedQueryParts.push({ text: parsed.content });
}

function parseFileContentPart(
  part: string,
  absoluteToRelativePathMap: Map<string, string>,
  config: AtCommandHelperRuntime,
): { displayPath: string; content: string } | undefined {
  const fileContentPattern = '^--- (.*?) ---\\n\\n([\\s\\S]*?)\\n\\n$';
  const fileContentRegex = new RegExp(fileContentPattern);

  const match = fileContentRegex.exec(part);

  if (!match) return undefined;
  const filePathSpecInContent = match[1];
  return {
    displayPath: resolveDisplayPath(
      filePathSpecInContent,
      absoluteToRelativePathMap,
      config,
    ),
    content: match[2].trim(),
  };
}

function resolveDisplayPath(
  filePathSpecInContent: string,
  absoluteToRelativePathMap: Map<string, string>,
  config: AtCommandHelperRuntime,
): string {
  const mappedPath = absoluteToRelativePathMap.get(filePathSpecInContent);
  if (mappedPath) return mappedPath;
  for (const dir of config.getWorkspaceContext().getDirectories()) {
    if (filePathSpecInContent.startsWith(dir))
      return path.relative(dir, filePathSpecInContent);
  }
  return filePathSpecInContent;
}
