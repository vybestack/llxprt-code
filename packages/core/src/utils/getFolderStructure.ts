/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { getErrorMessage, isNodeError } from './errors.js';
import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { FileFilteringOptions } from '../config/constants.js';
import { DEFAULT_FILE_FILTERING_OPTIONS } from '../config/constants.js';
import { debugLogger } from './debugLogger.js';

const MAX_ITEMS = 200;
const TRUNCATION_INDICATOR = '...';
const DEFAULT_IGNORED_FOLDERS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
]);

// --- Interfaces ---

/** Options for customizing folder structure retrieval. */
interface FolderStructureOptions {
  /** Maximum number of files and folders combined to display. Defaults to 200. */
  maxItems?: number;
  /** Set of folder names to ignore completely. Case-sensitive. */
  ignoredFolders?: Set<string>;
  /** Optional regex to filter included files by name. */
  fileIncludePattern?: RegExp;
  /** For filtering files. */
  fileService?: FileDiscoveryService;
  /** File filtering ignore options. */
  fileFilteringOptions?: FileFilteringOptions;
}
// Define a type for the merged options where fileIncludePattern remains optional
type MergedFolderStructureOptions = Required<
  Omit<FolderStructureOptions, 'fileIncludePattern' | 'fileService'>
> & {
  fileIncludePattern?: RegExp;
  fileService?: FileDiscoveryService;
  fileFilteringOptions?: FileFilteringOptions;
};

/** Represents the full, unfiltered information about a folder and its contents. */
interface FullFolderInfo {
  name: string;
  path: string;
  files: string[];
  subFolders: FullFolderInfo[];
  totalChildren: number; // Number of files and subfolders included from this folder during BFS scan
  totalFiles: number; // Number of files included from this folder during BFS scan
  isIgnored?: boolean; // Flag to easily identify ignored folders later
  hasMoreFiles?: boolean; // Indicates if files were truncated for this specific folder
  hasMoreSubfolders?: boolean; // Indicates if subfolders were truncated for this specific folder
}

// --- Interfaces ---

// --- Helper Functions ---

function shouldIgnorePath(
  filePath: string,
  fileService: FileDiscoveryService | undefined,
  fileFilteringOptions: FileFilteringOptions,
): boolean {
  if (!fileService) return false;
  return !!(
    (fileFilteringOptions.respectGitIgnore &&
      fileService.shouldGitIgnoreFile(filePath)) ||
    (fileFilteringOptions.respectLlxprtIgnore &&
      fileService.shouldLlxprtIgnoreFile(filePath))
  );
}

async function readDirectoryEntries(
  currentPath: string,
  rootPath: string,
): Promise<Dirent[] | null> {
  try {
    const rawEntries = await fs.readdir(currentPath, { withFileTypes: true });
    return rawEntries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error: unknown) {
    if (
      isNodeError(error) &&
      (error.code === 'EACCES' || error.code === 'ENOENT')
    ) {
      debugLogger.warn(
        `Warning: Could not read directory ${currentPath}: ${error.message}`,
      );
      if (currentPath === rootPath && error.code === 'ENOENT') {
        return null;
      }
      return [];
    }
    throw error;
  }
}

function collectFilesFromEntries(
  entries: Dirent[],
  currentPath: string,
  folderInfo: FullFolderInfo,
  options: MergedFolderStructureOptions,
  itemCount: { count: number },
): string[] {
  const filesInCurrentDir: string[] = [];
  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (itemCount.count >= options.maxItems) {
      folderInfo.hasMoreFiles = true;
      break;
    }
    const fileName = entry.name;
    const filePath = path.join(currentPath, fileName);
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (
      shouldIgnorePath(
        filePath,
        options.fileService,
        options.fileFilteringOptions,
      )
    ) {
      continue;
    }
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (
      !options.fileIncludePattern ||
      options.fileIncludePattern.test(fileName)
    ) {
      filesInCurrentDir.push(fileName);
      itemCount.count++;
      folderInfo.totalFiles++;
      folderInfo.totalChildren++;
    }
  }
  return filesInCurrentDir;
}

function collectSubFoldersFromEntries(
  entries: Dirent[],
  currentPath: string,
  folderInfo: FullFolderInfo,
  options: MergedFolderStructureOptions,
  itemCount: { count: number },
  queue: Array<{ folderInfo: FullFolderInfo; currentPath: string }>,
): FullFolderInfo[] {
  const subFoldersInCurrentDir: FullFolderInfo[] = [];
  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (itemCount.count >= options.maxItems) {
      folderInfo.hasMoreSubfolders = true;
      break;
    }
    const subFolderName = entry.name;
    const subFolderPath = path.join(currentPath, subFolderName);

    const isIgnored = shouldIgnorePath(
      subFolderPath,
      options.fileService,
      options.fileFilteringOptions,
    );
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (options.ignoredFolders.has(subFolderName) || isIgnored) {
      subFoldersInCurrentDir.push({
        name: subFolderName,
        path: subFolderPath,
        files: [],
        subFolders: [],
        totalChildren: 0,
        totalFiles: 0,
        isIgnored: true,
      });
      itemCount.count++;
      folderInfo.totalChildren++;
      continue;
    }

    const subFolderNode: FullFolderInfo = {
      name: subFolderName,
      path: subFolderPath,
      files: [],
      subFolders: [],
      totalChildren: 0,
      totalFiles: 0,
    };
    subFoldersInCurrentDir.push(subFolderNode);
    itemCount.count++;
    folderInfo.totalChildren++;
    queue.push({ folderInfo: subFolderNode, currentPath: subFolderPath });
  }
  return subFoldersInCurrentDir;
}

async function readFullStructure(
  rootPath: string,
  options: MergedFolderStructureOptions,
): Promise<FullFolderInfo | null> {
  const rootNode: FullFolderInfo = {
    name: path.basename(rootPath),
    path: rootPath,
    files: [],
    subFolders: [],
    totalChildren: 0,
    totalFiles: 0,
  };

  const queue: Array<{ folderInfo: FullFolderInfo; currentPath: string }> = [
    { folderInfo: rootNode, currentPath: rootPath },
  ];
  const itemCount = { count: 0 };
  const processedPaths = new Set<string>();

  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  while (queue.length > 0) {
    const { folderInfo, currentPath } = queue.shift()!;

    if (processedPaths.has(currentPath)) continue;
    processedPaths.add(currentPath);

    if (itemCount.count >= options.maxItems) continue;

    const entries = await readDirectoryEntries(currentPath, rootPath);
    if (entries === null) return null;

    folderInfo.files = collectFilesFromEntries(
      entries,
      currentPath,
      folderInfo,
      options,
      itemCount,
    );
    folderInfo.subFolders = collectSubFoldersFromEntries(
      entries,
      currentPath,
      folderInfo,
      options,
      itemCount,
      queue,
    );
  }

  return rootNode;
}

/**
 * Reads the directory structure using BFS, respecting maxItems.
 * @param node The current node in the reduced structure.
 * @param indent The current indentation string.
 * @param isLast Sibling indicator.
 * @param builder Array to build the string lines.
 */
function formatStructure(
  node: FullFolderInfo,
  currentIndent: string,
  isLastChildOfParent: boolean,
  isProcessingRootNode: boolean,
  builder: string[],
): void {
  const connector = isLastChildOfParent ? '└───' : '├───';

  // The root node of the structure (the one passed initially to getFolderStructure)
  // is not printed with a connector line itself, only its name as a header.
  // Its children are printed relative to that conceptual root.
  // Ignored root nodes ARE printed with a connector.
  if (!isProcessingRootNode || node.isIgnored === true) {
    builder.push(
      `${currentIndent}${connector}${node.name}${path.sep}${node.isIgnored === true ? TRUNCATION_INDICATOR : ''}`,
    );
  }

  // Determine the indent for the children of *this* node.
  // If *this* node was the root of the whole structure, its children start with no indent before their connectors.
  // Otherwise, children's indent extends from the current node's indent.
  const indentForChildren = isProcessingRootNode
    ? ''
    : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      currentIndent + (isLastChildOfParent ? '    ' : '│   ');

  // Render files of the current node
  const fileCount = node.files.length;
  for (let i = 0; i < fileCount; i++) {
    const isLastFileAmongSiblings =
      i === fileCount - 1 &&
      node.subFolders.length === 0 &&
      node.hasMoreSubfolders !== true;
    const fileConnector = isLastFileAmongSiblings ? '└───' : '├───';
    builder.push(`${indentForChildren}${fileConnector}${node.files[i]}`);
  }
  if (node.hasMoreFiles === true) {
    const isLastIndicatorAmongSiblings =
      node.subFolders.length === 0 && node.hasMoreSubfolders !== true;
    const fileConnector = isLastIndicatorAmongSiblings ? '└───' : '├───';
    builder.push(`${indentForChildren}${fileConnector}${TRUNCATION_INDICATOR}`);
  }

  // Render subfolders of the current node
  const subFolderCount = node.subFolders.length;
  for (let i = 0; i < subFolderCount; i++) {
    const isLastSubfolderAmongSiblings =
      i === subFolderCount - 1 && node.hasMoreSubfolders !== true;
    // Children are never the root node being processed initially.
    formatStructure(
      node.subFolders[i],
      indentForChildren,
      isLastSubfolderAmongSiblings,
      false,
      builder,
    );
  }
  if (node.hasMoreSubfolders === true) {
    builder.push(`${indentForChildren}└───${TRUNCATION_INDICATOR}`);
  }
}

// --- Main Exported Function ---

/**
 * Generates a string representation of a directory's structure,
 * limiting the number of items displayed. Ignored folders are shown
 * followed by '...' instead of their contents.
 *
 * @param directory The absolute or relative path to the directory.
 * @param options Optional configuration settings.
 * @returns A promise resolving to the formatted folder structure string.
 */
export async function getFolderStructure(
  directory: string,
  options?: FolderStructureOptions,
): Promise<string> {
  const resolvedPath = path.resolve(directory);
  const mergedOptions: MergedFolderStructureOptions = {
    maxItems: options?.maxItems ?? MAX_ITEMS,
    ignoredFolders: options?.ignoredFolders ?? DEFAULT_IGNORED_FOLDERS,
    fileIncludePattern: options?.fileIncludePattern,
    fileService: options?.fileService,
    fileFilteringOptions:
      options?.fileFilteringOptions ?? DEFAULT_FILE_FILTERING_OPTIONS,
  };

  try {
    // 1. Read the structure using BFS, respecting maxItems
    const structureRoot = await readFullStructure(resolvedPath, mergedOptions);

    if (!structureRoot) {
      return `Error: Could not read directory "${resolvedPath}". Check path and permissions.`;
    }

    // 2. Format the structure into a string
    const structureLines: string[] = [];
    // Pass true for isRoot for the initial call
    formatStructure(structureRoot, '', true, true, structureLines);

    // 3. Build the final output string
    function isTruncated(node: FullFolderInfo): boolean {
      if (
        node.hasMoreFiles === true ||
        node.hasMoreSubfolders === true ||
        node.isIgnored === true
      ) {
        return true;
      }
      for (const sub of node.subFolders) {
        if (isTruncated(sub)) {
          return true;
        }
      }
      return false;
    }

    let summary = `Showing up to ${mergedOptions.maxItems} items (files + folders).`;

    if (isTruncated(structureRoot)) {
      summary += ` Folders or files indicated with ${TRUNCATION_INDICATOR} contain more items not shown, were ignored, or the display limit (${mergedOptions.maxItems} items) was reached.`;
    }

    return `${summary}\n\n${resolvedPath}${path.sep}\n${structureLines.join('\n')}`;
  } catch (error: unknown) {
    debugLogger.error(
      `Error getting folder structure for ${resolvedPath}:`,
      error,
    );
    return `Error processing directory "${resolvedPath}": ${getErrorMessage(error)}`;
  }
}
