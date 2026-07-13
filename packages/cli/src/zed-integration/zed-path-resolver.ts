/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getErrorMessage,
  isNodeError,
  isWithinRoot,
  type Config,
  type ContentBlock,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type {
  FileSystemService,
  FilterFilesOptions,
} from '@vybestack/llxprt-code-storage';
import type * as acp from '@agentclientprotocol/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { normalizeToParts } from './zed-content-utils.js';

interface DebugFn {
  (msg: string): void;
}

/**
 * Internal resolver part shape. The Zed path resolver works with three kinds
 * of parts during resolution: plain text, inline binary media, and file-URI
 * references (fileData). These are converted to proper ContentBlock variants
 * at the resolvePrompt return boundary.
 */
type ResolverTextPart = { type: 'text'; text: string };
type ResolverMediaPart = {
  type: 'media';
  mimeType: string;
  data: string;
};
type ResolverFilePart = {
  type: 'file';
  fileData: { mimeData: string | null; name: string; fileUri: string };
};
type ResolverPart = ResolverTextPart | ResolverMediaPart | ResolverFilePart;

function isResolverFilePart(part: ResolverPart): part is ResolverFilePart {
  return part.type === 'file';
}

function isResolverMediaPart(part: ResolverPart): part is ResolverMediaPart {
  return part.type === 'media';
}

function resolverPartToText(part: ResolverPart): string | undefined {
  return part.type === 'text' ? part.text : undefined;
}

function resolverPartToFileUri(part: ResolverPart): string | undefined {
  return part.type === 'file' ? part.fileData.fileUri : undefined;
}
/**
 * Converts internal ResolverPart[] to ContentBlock[] for the public API.
 * File-reference parts become text blocks with @path markers.
 */
function resolverPartsToContentBlocks(parts: ResolverPart[]): ContentBlock[] {
  return parts.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    if (part.type === 'media') {
      return {
        type: 'media',
        mimeType: part.mimeType,
        data: part.data,
        encoding: 'base64',
      };
    }
    return { type: 'text', text: `@${part.fileData.fileUri}` };
  });
}

export class ZedPathResolver {
  constructor(
    private readonly config: Config,
    private readonly debug: DebugFn,
  ) {}

  async resolvePrompt(
    message: acp.ContentBlock[],
    abortSignal: AbortSignal,
  ): Promise<ContentBlock[]> {
    const FILE_URI_SCHEME = 'file://';

    const { parts, embeddedContext } = this.convertContentBlocks(
      message,
      FILE_URI_SCHEME,
    );

    const atPathCommandParts = parts.filter(isResolverFilePart);

    if (atPathCommandParts.length === 0 && embeddedContext.length === 0) {
      return resolverPartsToContentBlocks(parts);
    }

    const atPathToResolvedSpecMap = new Map<string, string>();

    const fileDiscovery = this.config.getFileService();
    const fileFilteringOptions: FilterFilesOptions =
      this.config.getFileFilteringOptions();

    const pathSpecsToRead: string[] = [];
    const contentLabelsForDisplay: string[] = [];
    const ignoredPaths: string[] = [];

    await this.resolvePathSpecs(
      atPathCommandParts,
      abortSignal,
      fileDiscovery,
      fileFilteringOptions,
      pathSpecsToRead,
      contentLabelsForDisplay,
      ignoredPaths,
      atPathToResolvedSpecMap,
    );

    const initialQueryText = this.buildQueryText(
      parts,
      atPathToResolvedSpecMap,
    );

    if (ignoredPaths.length > 0) {
      this.debug(
        `Ignored ${ignoredPaths.length} files: ${ignoredPaths.join(', ')}`,
      );
    }

    const processedQueryParts: ResolverPart[] = [
      { type: 'text', text: initialQueryText },
    ];

    // Preserve existing media parts (images/audio) from the original prompt.
    for (const part of parts) {
      if (isResolverMediaPart(part)) {
        processedQueryParts.push(part);
      }
    }

    if (pathSpecsToRead.length === 0 && embeddedContext.length === 0) {
      debugLogger.warn('No valid file paths found in @ commands to read.');
      return resolverPartsToContentBlocks(processedQueryParts);
    }

    if (pathSpecsToRead.length > 0) {
      await this.readReferencedFiles(
        pathSpecsToRead,
        contentLabelsForDisplay,
        abortSignal,
        processedQueryParts,
      );
    }

    if (embeddedContext.length > 0) {
      this.appendEmbeddedContext(processedQueryParts, embeddedContext);
    }

    return resolverPartsToContentBlocks(processedQueryParts);
  }

  private convertContentBlocks(
    message: acp.ContentBlock[],
    fileUriScheme: string,
  ): {
    parts: ResolverPart[];
    embeddedContext: acp.EmbeddedResourceResource[];
  } {
    const embeddedContext: acp.EmbeddedResourceResource[] = [];

    const parts = message.map((part): ResolverPart => {
      switch (part.type) {
        case 'text':
          return { type: 'text', text: part.text };
        case 'image':
        case 'audio':
          return {
            type: 'media',
            mimeType: part.mimeType,
            data: part.data,
          };
        case 'resource_link': {
          if (part.uri.startsWith(fileUriScheme)) {
            return {
              type: 'file',
              fileData: {
                mimeData: part.mimeType ?? null,
                name: part.name,
                fileUri: part.uri.slice(fileUriScheme.length),
              },
            };
          }
          return { type: 'text', text: `@${part.uri}` };
        }
        case 'resource': {
          embeddedContext.push(part.resource);
          return { type: 'text', text: `@${part.resource.uri}` };
        }
        default: {
          const unreachable: never = part;
          throw new Error(`Unexpected chunk type: '${unreachable}'`);
        }
      }
    });

    return { parts, embeddedContext };
  }

  private async resolvePathSpecs(
    atPathCommandParts: ResolverFilePart[],
    abortSignal: AbortSignal,
    fileDiscovery: ReturnType<Config['getFileService']>,
    fileFilteringOptions: FilterFilesOptions,
    pathSpecsToRead: string[],
    contentLabelsForDisplay: string[],
    ignoredPaths: string[],
    atPathToResolvedSpecMap: Map<string, string>,
  ): Promise<void> {
    for (const atPathPart of atPathCommandParts) {
      const pathName = atPathPart.fileData.fileUri;
      const { currentPathSpec, resolvedSuccessfully } =
        await this.resolveSinglePath(pathName, abortSignal);
      if (resolvedSuccessfully) {
        this.appendResolvedPathSpec(
          currentPathSpec,
          pathName,
          fileDiscovery,
          fileFilteringOptions,
          pathSpecsToRead,
          contentLabelsForDisplay,
          ignoredPaths,
          atPathToResolvedSpecMap,
        );
      }
    }
  }

  private appendResolvedPathSpec(
    currentPathSpec: string,
    pathName: string,
    fileDiscovery: ReturnType<Config['getFileService']>,
    fileFilteringOptions: FilterFilesOptions,
    pathSpecsToRead: string[],
    contentLabelsForDisplay: string[],
    ignoredPaths: string[],
    atPathToResolvedSpecMap: Map<string, string>,
  ): void {
    if (fileDiscovery.shouldIgnoreFile(currentPathSpec, fileFilteringOptions)) {
      ignoredPaths.push(currentPathSpec);
      this.debug(`Path ${currentPathSpec} is ignored and will be skipped.`);
      return;
    }
    pathSpecsToRead.push(currentPathSpec);
    atPathToResolvedSpecMap.set(pathName, currentPathSpec);
    contentLabelsForDisplay.push(pathName);
  }

  private async resolveSinglePath(
    pathName: string,
    abortSignal: AbortSignal,
  ): Promise<{ currentPathSpec: string; resolvedSuccessfully: boolean }> {
    let currentPathSpec = pathName;
    let resolvedSuccessfully = false;
    try {
      const targetDir = this.config.getTargetDir();
      if (this.isGlobPath(pathName)) {
        const globBase = this.getGlobBasePath(pathName);
        const absoluteBase = path.resolve(targetDir, globBase);
        if (isWithinRoot(absoluteBase, targetDir)) {
          this.debug(`Path ${pathName} resolved to glob: ${pathName}`);
          return { currentPathSpec: pathName, resolvedSuccessfully: true };
        }
        this.debug(
          `Path ${pathName} is outside the project directory. Skipping.`,
        );
        return { currentPathSpec, resolvedSuccessfully: false };
      }

      const absolutePath = path.resolve(targetDir, pathName);
      if (isWithinRoot(absolutePath, targetDir)) {
        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) {
          currentPathSpec = pathName.endsWith('/')
            ? `${pathName}**`
            : `${pathName}/**`;
          this.debug(
            `Path ${pathName} resolved to directory, using glob: ${currentPathSpec}`,
          );
        } else {
          this.debug(`Path ${pathName} resolved to file: ${currentPathSpec}`);
        }
        resolvedSuccessfully = true;
      } else {
        this.debug(
          `Path ${pathName} is outside the project directory. Skipping.`,
        );
      }
    } catch (error) {
      const result = await this.resolveMissingPath(
        pathName,
        error,
        abortSignal,
      );
      resolvedSuccessfully = result.resolved;
      if (resolvedSuccessfully && result.resolvedSpec) {
        currentPathSpec = result.resolvedSpec;
      }
    }
    return { currentPathSpec, resolvedSuccessfully };
  }

  private isGlobPath(pathName: string): boolean {
    return /[*?[\]{}()!+]/.test(pathName);
  }

  private getGlobBasePath(pathName: string): string {
    const firstGlobIndex = pathName.search(/[*?[\]{}()!+]/);
    if (firstGlobIndex < 0) {
      return pathName;
    }
    const prefix = pathName.slice(0, firstGlobIndex);
    const separatorIndex = prefix.lastIndexOf(path.sep);
    if (separatorIndex < 0) {
      return '.';
    }
    return prefix.slice(0, separatorIndex + 1);
  }

  private async resolveMissingPath(
    pathName: string,
    error: unknown,
    abortSignal: AbortSignal,
  ): Promise<{ resolved: boolean; resolvedSpec?: string }> {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      debugLogger.error(
        `Error stating path ${pathName}. Path ${pathName} will be skipped.`,
      );
      return { resolved: false };
    }

    if (!this.config.getEnableRecursiveFileSearch()) {
      this.debug(
        `Recursive file search disabled. Path ${pathName} will be skipped.`,
      );
      return { resolved: false };
    }

    this.debug(`Path ${pathName} not found directly, attempting glob search.`);
    try {
      const relativePath = await this.globSearchFirstMatch(
        pathName,
        abortSignal,
      );
      if (relativePath !== undefined) {
        this.debug(
          `Glob search for ${pathName} found match, using relative path: ${relativePath}`,
        );
        return { resolved: true, resolvedSpec: relativePath };
      }
      this.debug(
        `Glob search for '**/*${pathName}*' did not return a usable path. Path ${pathName} will be skipped.`,
      );
    } catch (globError) {
      debugLogger.error(
        `Error during glob search for ${pathName}: ${getErrorMessage(globError)}`,
      );
    }
    return { resolved: false };
  }

  private async globSearchFirstMatch(
    pathName: string,
    abortSignal: AbortSignal,
  ): Promise<string | undefined> {
    const targetDir = this.config.getTargetDir();
    const entries = await glob(`**/*${pathName}*`, {
      cwd: targetDir,
      nodir: true,
      dot: true,
      ignore: this.resolveGlobIgnore(),
      signal: abortSignal,
    });
    return entries.find((entry) => !this.shouldSkipDiscoveredPath(entry));
  }

  private resolveGlobIgnore(): string[] {
    try {
      return this.config.getFileExclusions().getCoreIgnorePatterns();
    } catch {
      return [];
    }
  }

  private buildQueryText(
    parts: ResolverPart[],
    atPathToResolvedSpecMap: Map<string, string>,
  ): string {
    let queryText = '';
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      const text = resolverPartToText(chunk);
      if (text !== undefined) {
        queryText += text;
      } else {
        queryText = this.appendPathToQueryText(
          chunk,
          parts,
          i,
          queryText,
          atPathToResolvedSpecMap,
        );
      }
    }
    return queryText.trim();
  }

  private appendPathToQueryText(
    chunk: ResolverPart,
    parts: ResolverPart[],
    i: number,
    queryText: string,
    atPathToResolvedSpecMap: Map<string, string>,
  ): string {
    const fileUri = resolverPartToFileUri(chunk);
    const resolvedSpec = fileUri
      ? atPathToResolvedSpecMap.get(fileUri)
      : undefined;

    if (this.shouldPrependSpace(i, queryText, resolvedSpec)) {
      const prevPart = parts[i - 1];
      const prevFileUri = resolverPartToFileUri(prevPart);
      if (
        resolverPartToText(prevPart) !== undefined ||
        (prevFileUri && atPathToResolvedSpecMap.has(prevFileUri))
      ) {
        queryText += ' ';
      }
    }

    if (resolvedSpec !== undefined && resolvedSpec.length > 0) {
      return queryText + `@${resolvedSpec}`;
    }

    if (
      i > 0 &&
      queryText.length > 0 &&
      !queryText.endsWith(' ') &&
      fileUri?.startsWith(' ') !== true
    ) {
      queryText += ' ';
    }
    if (fileUri !== undefined && fileUri.length > 0) {
      return queryText + `@${fileUri}`;
    }
    return queryText;
  }

  private shouldPrependSpace(
    i: number,
    queryText: string,
    resolvedSpec: string | false | undefined,
  ): boolean {
    if (typeof resolvedSpec !== 'string' || resolvedSpec.length === 0) {
      return false;
    }
    return i > 0 && queryText.length > 0 && !queryText.endsWith(' ');
  }

  private async readReferencedFiles(
    pathSpecsToRead: string[],
    contentLabelsForDisplay: string[],
    abortSignal: AbortSignal,
    processedQueryParts: ResolverPart[],
  ): Promise<void> {
    const targetDir = this.config.getTargetDir();
    const fileSystemService = this.config.getFileSystemService();
    processedQueryParts.push({
      type: 'text',
      text: '\n--- Content from referenced files ---',
    });

    for (let i = 0; i < pathSpecsToRead.length; i++) {
      if (abortSignal.aborted) {
        return;
      }
      const spec = pathSpecsToRead[i];
      const label = contentLabelsForDisplay[i] ?? spec;
      await this.appendSingleSpec(
        spec,
        label,
        targetDir,
        fileSystemService,
        abortSignal,
        processedQueryParts,
      );
    }
  }

  private async appendSingleSpec(
    spec: string,
    label: string,
    targetDir: string,
    fileSystemService: FileSystemService,
    abortSignal: AbortSignal,
    processedQueryParts: ResolverPart[],
  ): Promise<void> {
    if (this.isGlobPath(spec)) {
      await this.appendGlobSpec(
        spec,
        label,
        targetDir,
        fileSystemService,
        abortSignal,
        processedQueryParts,
      );
      return;
    }
    await this.appendSingleFile(
      spec,
      label,
      targetDir,
      fileSystemService,
      abortSignal,
      processedQueryParts,
    );
  }

  private async appendGlobSpec(
    spec: string,
    label: string,
    targetDir: string,
    fileSystemService: FileSystemService,
    abortSignal: AbortSignal,
    processedQueryParts: ResolverPart[],
  ): Promise<void> {
    try {
      const matches = await glob(spec, {
        cwd: targetDir,
        nodir: true,
        dot: true,
        ignore: this.resolveGlobIgnore(),
        signal: abortSignal,
      });
      for (const match of matches) {
        if (abortSignal.aborted) {
          return;
        }
        if (this.shouldSkipDiscoveredPath(match)) {
          continue;
        }
        const absolute = path.isAbsolute(match)
          ? match
          : path.join(targetDir, match);
        const appended = await this.readAndAppendGlobMatch(
          match,
          absolute,
          fileSystemService,
          abortSignal,
          processedQueryParts,
        );
        if (!appended) {
          return;
        }
      }
    } catch (error) {
      if (abortSignal.aborted) {
        return;
      }
      processedQueryParts.push({
        type: 'text',
        text: `\nError reading files (${label}): ${getErrorMessage(error)}`,
      });
    }
  }

  private async readAndAppendGlobMatch(
    match: string,
    absolute: string,
    fileSystemService: FileSystemService,
    abortSignal: AbortSignal,
    processedQueryParts: ResolverPart[],
  ): Promise<boolean> {
    const content = await fileSystemService.readTextFile(absolute);
    if (abortSignal.aborted) {
      return false;
    }
    processedQueryParts.push({
      type: 'text',
      text: `\nContent from @${match}:\n`,
    });
    processedQueryParts.push({ type: 'text', text: content });
    return true;
  }

  private shouldSkipDiscoveredPath(filePath: string): boolean {
    return this.config
      .getFileService()
      .shouldIgnoreFile(filePath, this.config.getFileFilteringOptions());
  }

  private async appendSingleFile(
    spec: string,
    label: string,
    targetDir: string,
    fileSystemService: FileSystemService,
    abortSignal: AbortSignal,
    processedQueryParts: ResolverPart[],
  ): Promise<void> {
    try {
      const absolute = path.isAbsolute(spec)
        ? spec
        : path.resolve(targetDir, spec);
      if (!isWithinRoot(absolute, targetDir)) {
        processedQueryParts.push({
          type: 'text',
          text: `\nSkipped file outside project root (${label}).`,
        });
        return;
      }
      const content = await fileSystemService.readTextFile(absolute);
      if (abortSignal.aborted) {
        return;
      }
      processedQueryParts.push({
        type: 'text',
        text: `\nContent from @${label}:\n`,
      });
      const contentParts = normalizeToParts(content);
      for (const part of contentParts) {
        processedQueryParts.push(
          part.type === 'text' ? part : { type: 'text', text: '' },
        );
      }
    } catch (error) {
      if (abortSignal.aborted) {
        return;
      }
      processedQueryParts.push({
        type: 'text',
        text: `\nError reading file (${label}): ${getErrorMessage(error)}`,
      });
    }
  }

  private appendEmbeddedContext(
    processedQueryParts: ResolverPart[],
    embeddedContext: acp.EmbeddedResourceResource[],
  ): void {
    processedQueryParts.push({
      type: 'text',
      text: '\n--- Content from referenced context ---',
    });

    for (const contextPart of embeddedContext) {
      processedQueryParts.push({
        type: 'text',
        text: `\nContent from @${contextPart.uri}:\n`,
      });
      if ('text' in contextPart) {
        processedQueryParts.push({
          type: 'text',
          text: contextPart.text,
        });
      } else {
        processedQueryParts.push({
          type: 'media',
          mimeType: contextPart.mimeType ?? 'application/octet-stream',
          data: contextPart.blob,
        });
      }
    }
  }
}
