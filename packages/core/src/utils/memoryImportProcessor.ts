/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { isSubpath } from './paths.js';
import { marked, type Token } from 'marked';
import { debugLogger } from './debugLogger.js';

// Simple console logger for import processing
const logger = {
  debug: (...args: unknown[]) =>
    debugLogger.debug('[DEBUG] [ImportProcessor]', ...args),
  warn: (...args: unknown[]) =>
    debugLogger.warn('[WARN] [ImportProcessor]', ...args),
  error: (...args: unknown[]) =>
    debugLogger.error('[ERROR] [ImportProcessor]', ...args),
};

/**
 * Interface for tracking import processing state to prevent circular imports
 */
interface ImportState {
  processedFiles: Set<string>;
  maxDepth: number;
  currentDepth: number;
  currentFile?: string; // Track the current file being processed
}

function nonEmptyPath(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Interface representing a file in the import tree
 */
export interface MemoryFile {
  path: string;
  imports?: MemoryFile[]; // Direct imports, in the order they were imported
}

/**
 * Result of processing imports
 */
export interface ProcessImportsResult {
  content: string;
  importTree: MemoryFile;
}

// Helper to find the project root (looks for .git directory)
async function findProjectRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  for (;;) {
    const gitPath = path.join(currentDir, '.git');
    try {
      const stats = await fs.lstat(gitPath);
      if (stats.isDirectory()) {
        return currentDir;
      }
    } catch {
      // .git not found, continue to parent
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }
  // Fallback to startDir if .git not found
  return path.resolve(startDir);
}

// Add a type guard for error objects
function hasMessage(err: unknown): err is { message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  );
}

// Helper to find all code block and inline code regions using marked
/**
 * Finds all import statements in content without using regex
 * @returns Array of {start, _end, path} objects for each import found
 */
function findImports(
  content: string,
): Array<{ start: number; _end: number; path: string }> {
  const imports: Array<{ start: number; _end: number; path: string }> = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    // Find next @ symbol
    i = content.indexOf('@', i);
    if (i === -1) {
      break;
    }

    // Advance past @ symbols that are part of another word
    if (i > 0 && !isWhitespace(content[i - 1])) {
      i++;
    } else {
      // Find the end of the import path (whitespace or newline)
      let j = i + 1;
      while (
        j < len &&
        !isWhitespace(content[j]) &&
        content[j] !== '\n' &&
        content[j] !== '\r'
      ) {
        j++;
      }

      // Extract the path (everything after @)
      const importPath = content.slice(i + 1, j);

      // Basic validation (starts with ./ or / or letter)
      if (
        importPath.length > 0 &&
        (importPath[0] === '.' ||
          importPath[0] === '/' ||
          isLetter(importPath[0]))
      ) {
        imports.push({
          start: i,
          _end: j,
          path: importPath,
        });
      }

      i = j + 1;
    }
  }

  return imports;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122)
  ); // a-z
}

function findCodeRegions(content: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const tokens = marked.lexer(content);
  let offset = 0;

  function walk(token: Token, baseOffset: number) {
    if (token.type === 'code' || token.type === 'codespan') {
      regions.push([baseOffset, baseOffset + token.raw.length]);
    }

    if ('tokens' in token && token.tokens) {
      let childOffset = 0;
      for (const child of token.tokens) {
        const childIndexInParent = token.raw.indexOf(child.raw, childOffset);
        if (childIndexInParent === -1) {
          logger.error(
            `Could not find child token in parent raw content. Aborting parsing for this branch. Child raw: "${child.raw}"`,
          );
          break;
        }
        walk(child, baseOffset + childIndexInParent);
        childOffset = childIndexInParent + child.raw.length;
      }
    }
  }

  for (const token of tokens) {
    walk(token, offset);
    offset += token.raw.length;
  }

  return regions;
}

/**
 * Processes import statements in LLXPRT.md content
 * Supports @path/to/file syntax for importing content from other files
 * @param content - The content to process for imports
 * @param basePath - The directory path where the current file is located
 * @param debugMode - Whether to enable debug logging
 * @param importState - State tracking for circular import prevention
 * @param projectRoot - The project root directory for allowed directories
 * @param importFormat - The format of the import tree
 * @returns Processed content with imports resolved and import tree
 */
export async function processImports(
  content: string,
  basePath: string,
  debugMode: boolean = false,
  importState: ImportState = {
    processedFiles: new Set(),
    maxDepth: 5,
    currentDepth: 0,
  },
  projectRoot?: string,
  importFormat: 'flat' | 'tree' = 'tree',
): Promise<ProcessImportsResult> {
  projectRoot ??= await findProjectRoot(basePath);

  if (importState.currentDepth >= importState.maxDepth) {
    if (debugMode) {
      logger.warn(
        `Maximum import depth (${importState.maxDepth}) reached. Stopping import processing.`,
      );
    }
    return {
      content,
      importTree: { path: nonEmptyPath(importState.currentFile, 'unknown') },
    };
  }

  if (importFormat === 'flat') {
    return processImportsFlat(
      content,
      basePath,
      debugMode,
      importState,
      projectRoot,
    );
  }

  return processImportsTree(
    content,
    basePath,
    debugMode,
    importState,
    projectRoot,
    importFormat,
  );
}

function formatFlatFiles(
  flatFiles: Array<{ path: string; content: string }>,
): string {
  return flatFiles
    .map(
      (f) =>
        `--- File: ${f.path} ---\n${f.content.trim()}\n--- End of File: ${f.path} ---`,
    )
    .join('\n\n');
}

async function processFlat(
  fileContent: string,
  fileBasePath: string,
  filePath: string,
  depth: number,
  processedFiles: Set<string>,
  flatFiles: Array<{ path: string; content: string }>,
  projectRoot: string | undefined,
  debugMode: boolean,
): Promise<void> {
  const normalizedPath = path.normalize(filePath);
  if (processedFiles.has(normalizedPath)) return;
  processedFiles.add(normalizedPath);
  flatFiles.push({ path: normalizedPath, content: fileContent });

  const codeRegions = findCodeRegions(fileContent);
  const imports = findImports(fileContent);

  for (let i = imports.length - 1; i >= 0; i--) {
    const { start, path: importPath } = imports[i];

    const inCodeRegion = codeRegions.some(
      ([regionStart, regionEnd]) => start >= regionStart && start < regionEnd,
    );
    const isValid = validateImportPath(importPath, fileBasePath, [
      projectRoot ?? '',
    ]);
    const fullPath = path.resolve(fileBasePath, importPath);
    const normalizedFullPath = path.normalize(fullPath);

    const alreadyProcessed = processedFiles.has(normalizedFullPath);
    if (inCodeRegion || !isValid || alreadyProcessed) {
      continue;
    }

    try {
      await fs.access(fullPath);
      const importedContent = await fs.readFile(fullPath, 'utf-8');
      await processFlat(
        importedContent,
        path.dirname(fullPath),
        normalizedFullPath,
        depth + 1,
        processedFiles,
        flatFiles,
        projectRoot,
        debugMode,
      );
    } catch (error) {
      const errorMessage = hasMessage(error) ? error.message : 'Unknown error';

      if (debugMode || !errorMessage.includes('ENOENT')) {
        logger.warn(`Failed to import ${fullPath}: ${errorMessage}`);
      }
    }
  }
}

async function processImportsFlat(
  content: string,
  basePath: string,
  debugMode: boolean,
  importState: ImportState,
  projectRoot: string | undefined,
): Promise<ProcessImportsResult> {
  const flatFiles: Array<{ path: string; content: string }> = [];
  const processedFiles = new Set<string>();

  const rootPath = path.normalize(
    nonEmptyPath(importState.currentFile, path.resolve(basePath)),
  );
  await processFlat(
    content,
    basePath,
    rootPath,
    0,
    processedFiles,
    flatFiles,
    projectRoot,
    debugMode,
  );

  const flatContent = formatFlatFiles(flatFiles);

  return {
    content: flatContent,
    importTree: { path: rootPath },
  };
}

async function processImportsTree(
  content: string,
  basePath: string,
  debugMode: boolean,
  importState: ImportState,
  projectRoot: string | undefined,
  importFormat: 'flat' | 'tree',
): Promise<ProcessImportsResult> {
  const codeRegions = findCodeRegions(content);
  let result = '';
  let lastIndex = 0;
  const imports: MemoryFile[] = [];
  const importsList = findImports(content);

  for (const { start, _end, path: importPath } of importsList) {
    result += content.substring(lastIndex, start);
    lastIndex = _end;

    const skipped = resolveSkippedImport(
      start,
      importPath,
      codeRegions,
      basePath,
      projectRoot,
      importState,
    );
    if (skipped !== null) {
      result += skipped;
      continue;
    }

    const fullPath = path.resolve(basePath, importPath);
    try {
      await fs.access(fullPath);
      const fileContent = await fs.readFile(fullPath, 'utf-8');
      const newImportState: ImportState = {
        ...importState,
        processedFiles: new Set(importState.processedFiles),
        currentDepth: importState.currentDepth + 1,
        currentFile: fullPath,
      };
      newImportState.processedFiles.add(fullPath);
      const imported = await processImports(
        fileContent,
        path.dirname(fullPath),
        debugMode,
        newImportState,
        projectRoot,
        importFormat,
      );
      result += `<!-- Imported from: ${importPath} -->\n${imported.content}\n<!-- End of import from: ${importPath} -->`;
      imports.push(imported.importTree);
    } catch (err: unknown) {
      let message = 'Unknown error';
      if (hasMessage(err)) {
        message = err.message;
      } else if (typeof err === 'string') {
        message = err;
      }

      if (debugMode || !message.includes('ENOENT')) {
        logger.error(`Failed to import ${importPath}: ${message}`);
      }

      result += `<!-- Import failed: ${importPath} - ${message} -->`;
    }
  }
  result += content.substring(lastIndex);

  return {
    content: result,
    importTree: {
      path: nonEmptyPath(importState.currentFile, 'unknown'),
      imports: imports.length > 0 ? imports : undefined,
    },
  };
}

export function validateImportPath(
  importPath: string,
  basePath: string,
  allowedDirectories: string[],
): boolean {
  // Reject URLs
  if (/^(file|https?):\/\//.test(importPath)) {
    return false;
  }

  const resolvedPath = path.resolve(basePath, importPath);

  return allowedDirectories.some((allowedDir) =>
    isSubpath(allowedDir, resolvedPath),
  );
}

function resolveSkippedImport(
  start: number,
  importPath: string,
  codeRegions: Array<[number, number]>,
  basePath: string,
  projectRoot: string | undefined,
  importState: ImportState,
): string | null {
  if (codeRegions.some(([s, e]) => start >= s && start < e)) {
    return `@${importPath}`;
  }
  if (!validateImportPath(importPath, basePath, [projectRoot ?? ''])) {
    return `<!-- Import failed: ${importPath} - Path traversal attempt -->`;
  }
  const fullPath = path.resolve(basePath, importPath);
  if (importState.processedFiles.has(fullPath)) {
    return `<!-- File already processed: ${importPath} -->`;
  }
  return null;
}
