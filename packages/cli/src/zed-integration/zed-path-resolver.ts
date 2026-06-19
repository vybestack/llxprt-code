/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  ToolResult,
  AnyDeclarativeTool,
} from '@vybestack/llxprt-code-core';
import {
  getErrorMessage,
  isNodeError,
  isWithinRoot,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import type { FilterFilesOptions } from '@vybestack/llxprt-code-storage';
import type * as acp from '@agentclientprotocol/sdk';
import type { Part, PartListUnion } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { toToolCallContent } from './zed-helpers.js';
import { normalizeToParts } from './zed-content-utils.js';

interface SendUpdateFn {
  (update: acp.SessionUpdate): Promise<void>;
}

interface DebugFn {
  (msg: string): void;
}

type GlobTool =
  | {
      buildAndExecute: (
        args: { pattern: string; path: string },
        signal: AbortSignal,
      ) => Promise<ToolResult>;
    }
  | undefined;

export class ZedPathResolver {
  constructor(
    private readonly config: Config,
    private readonly sendUpdate: SendUpdateFn,
    private readonly debug: DebugFn,
  ) {}

  async resolvePrompt(
    message: acp.ContentBlock[],
    abortSignal: AbortSignal,
  ): Promise<Part[]> {
    const FILE_URI_SCHEME = 'file://';

    const { parts, embeddedContext } = this.convertContentBlocks(
      message,
      FILE_URI_SCHEME,
    );

    const atPathCommandParts = parts.filter((part) => 'fileData' in part);

    if (atPathCommandParts.length === 0 && embeddedContext.length === 0) {
      return parts;
    }

    const atPathToResolvedSpecMap = new Map<string, string>();

    const fileDiscovery = this.config.getFileService();
    const fileFilteringOptions: FilterFilesOptions =
      this.config.getFileFilteringOptions();

    const pathSpecsToRead: string[] = [];
    const contentLabelsForDisplay: string[] = [];
    const ignoredPaths: string[] = [];

    const toolRegistry = this.config.getToolRegistry();
    const readManyFilesTool = toolRegistry.getTool('read_many_files')!;
    const globTool = toolRegistry.getTool('glob');

    await this.resolvePathSpecs(
      atPathCommandParts,
      abortSignal,
      fileDiscovery,
      fileFilteringOptions,
      pathSpecsToRead,
      contentLabelsForDisplay,
      ignoredPaths,
      atPathToResolvedSpecMap,
      globTool,
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

    const processedQueryParts: Part[] = [{ text: initialQueryText }];

    // Preserve existing inlineData parts (images/audio) from the original prompt.
    for (const part of parts) {
      if ('inlineData' in part) {
        processedQueryParts.push(part);
      }
    }

    if (pathSpecsToRead.length === 0 && embeddedContext.length === 0) {
      debugLogger.warn('No valid file paths found in @ commands to read.');
      return processedQueryParts;
    }

    if (pathSpecsToRead.length > 0) {
      await this.readReferencedFiles(
        pathSpecsToRead,
        contentLabelsForDisplay,
        readManyFilesTool,
        abortSignal,
        processedQueryParts,
      );
    }

    if (embeddedContext.length > 0) {
      this.appendEmbeddedContext(processedQueryParts, embeddedContext);
    }

    return processedQueryParts;
  }

  private convertContentBlocks(
    message: acp.ContentBlock[],
    fileUriScheme: string,
  ): {
    parts: Part[];
    embeddedContext: acp.EmbeddedResourceResource[];
  } {
    const embeddedContext: acp.EmbeddedResourceResource[] = [];

    const parts = message.map((part) => {
      switch (part.type) {
        case 'text':
          return { text: part.text };
        case 'image':
        case 'audio':
          return {
            inlineData: {
              mimeType: part.mimeType,
              data: part.data,
            },
          };
        case 'resource_link': {
          if (part.uri.startsWith(fileUriScheme)) {
            return {
              fileData: {
                mimeData: part.mimeType,
                name: part.name,
                fileUri: part.uri.slice(fileUriScheme.length),
              },
            };
          }
          return { text: `@${part.uri}` };
        }
        case 'resource': {
          embeddedContext.push(part.resource);
          return { text: `@${part.resource.uri}` };
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
    atPathCommandParts: Part[],
    abortSignal: AbortSignal,
    fileDiscovery: ReturnType<Config['getFileService']>,
    fileFilteringOptions: FilterFilesOptions,
    pathSpecsToRead: string[],
    contentLabelsForDisplay: string[],
    ignoredPaths: string[],
    atPathToResolvedSpecMap: Map<string, string>,
    globTool: GlobTool,
  ): Promise<void> {
    for (const atPathPart of atPathCommandParts) {
      const pathName = (atPathPart as { fileData: { fileUri: string } })
        .fileData.fileUri;
      if (fileDiscovery.shouldIgnoreFile(pathName, fileFilteringOptions)) {
        ignoredPaths.push(pathName);
        this.debug(`Path ${pathName} is ignored and will be skipped.`);
        continue;
      }
      const { currentPathSpec, resolvedSuccessfully } =
        await this.resolveSinglePath(pathName, abortSignal, globTool);
      if (resolvedSuccessfully) {
        pathSpecsToRead.push(currentPathSpec);
        atPathToResolvedSpecMap.set(pathName, currentPathSpec);
        contentLabelsForDisplay.push(pathName);
      }
    }
  }

  private async resolveSinglePath(
    pathName: string,
    abortSignal: AbortSignal,
    globTool: GlobTool,
  ): Promise<{ currentPathSpec: string; resolvedSuccessfully: boolean }> {
    let currentPathSpec = pathName;
    let resolvedSuccessfully = false;
    try {
      const absolutePath = path.resolve(this.config.getTargetDir(), pathName);
      if (isWithinRoot(absolutePath, this.config.getTargetDir())) {
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
        globTool,
      );
      resolvedSuccessfully = result.resolved;
      if (resolvedSuccessfully && result.resolvedSpec) {
        currentPathSpec = result.resolvedSpec;
      }
    }
    return { currentPathSpec, resolvedSuccessfully };
  }

  private async resolveMissingPath(
    pathName: string,
    error: unknown,
    abortSignal: AbortSignal,
    globTool: GlobTool,
  ): Promise<{ resolved: boolean; resolvedSpec?: string }> {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      debugLogger.error(
        `Error stating path ${pathName}. Path ${pathName} will be skipped.`,
      );
      return { resolved: false };
    }

    if (!this.config.getEnableRecursiveFileSearch() || !globTool) {
      this.debug(`Glob tool not found. Path ${pathName} will be skipped.`);
      return { resolved: false };
    }

    this.debug(`Path ${pathName} not found directly, attempting glob search.`);
    try {
      const globResult = await globTool.buildAndExecute(
        {
          pattern: `**/*${pathName}*`,
          path: this.config.getTargetDir(),
        },
        abortSignal,
      );
      const resolved = this.extractGlobResult(pathName, globResult);
      if (resolved) {
        this.debug(
          `Glob search for ${pathName} found ${resolved.absolutePath}, using relative path: ${resolved.relativePath}`,
        );
        return { resolved: true, resolvedSpec: resolved.relativePath };
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

  private extractGlobResult(
    pathName: string,
    globResult: ToolResult,
  ): { absolutePath: string; relativePath: string } | undefined {
    if (
      typeof globResult.llmContent === 'string' &&
      !globResult.llmContent.startsWith('No files found') &&
      !globResult.llmContent.startsWith('Error:')
    ) {
      const lines = globResult.llmContent.split('\n');
      if (lines.length > 1 && lines[1]) {
        const firstMatchAbsolute = lines[1].trim();
        return {
          absolutePath: firstMatchAbsolute,
          relativePath: path.relative(
            this.config.getTargetDir(),
            firstMatchAbsolute,
          ),
        };
      }
      this.debug(
        `Glob search for '**/*${pathName}*' did not return a usable path. Path ${pathName} will be skipped.`,
      );
    } else {
      this.debug(
        `Glob search for '**/*${pathName}*' found no files or an error. Path ${pathName} will be skipped.`,
      );
    }
    return undefined;
  }

  private buildQueryText(
    parts: Part[],
    atPathToResolvedSpecMap: Map<string, string>,
  ): string {
    let queryText = '';
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      if ('text' in chunk) {
        queryText += chunk.text;
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
    chunk: Part,
    parts: Part[],
    i: number,
    queryText: string,
    atPathToResolvedSpecMap: Map<string, string>,
  ): string {
    const resolvedSpec =
      chunk.fileData &&
      atPathToResolvedSpecMap.get(
        (chunk as { fileData: { fileUri: string } }).fileData.fileUri,
      );

    if (this.shouldPrependSpace(i, queryText, resolvedSpec)) {
      const prevPart = parts[i - 1];
      if (
        'text' in prevPart ||
        ('fileData' in prevPart &&
          atPathToResolvedSpecMap.has(
            (prevPart as { fileData: { fileUri: string } }).fileData.fileUri,
          ))
      ) {
        queryText += ' ';
      }
    }

    if (resolvedSpec !== undefined && resolvedSpec.length > 0) {
      return queryText + `@${resolvedSpec}`;
    }

    const fileUri = (chunk as { fileData?: { fileUri: string } }).fileData
      ?.fileUri;
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
    readManyFilesTool: AnyDeclarativeTool,
    abortSignal: AbortSignal,
    processedQueryParts: Part[],
  ): Promise<void> {
    const toolArgs = { paths: pathSpecsToRead };
    const callId = `${readManyFilesTool.name}-${Date.now()}`;

    try {
      const invocation = readManyFilesTool.build(toolArgs);

      await this.sendUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: callId,
        status: 'in_progress',
        title: invocation.getDescription(),
        content: [],
        locations: invocation.toolLocations(),
        kind: (invocation as { kind?: string }).kind as
          | acp.ToolKind
          | undefined,
      });

      const result = await invocation.execute(abortSignal);
      const content = toToolCallContent(result) ?? {
        type: 'content',
        content: {
          type: 'text',
          text: `Successfully read: ${contentLabelsForDisplay.join(', ')}`,
        },
      };
      await this.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'completed',
        content: [content],
      });

      this.appendFileContent(result.llmContent, processedQueryParts);
    } catch (error: unknown) {
      await this.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'failed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: `Error reading files (${contentLabelsForDisplay.join(', ')}): ${getErrorMessage(error)}`,
            },
          },
        ],
      });

      throw error;
    }
  }

  private appendFileContent(
    llmContent: PartListUnion | undefined,
    processedQueryParts: Part[],
  ): void {
    if (llmContent === undefined) {
      debugLogger.warn(
        'read_many_files tool returned no content or empty content.',
      );
      return;
    }

    const parts = normalizeToParts(llmContent);
    const fileContentRegex = /^--- (.*?) ---\n\n([\s\S]*?)\n\n$/;
    processedQueryParts.push({
      text: '\n--- Content from referenced files ---',
    });
    for (const part of parts) {
      if (typeof part.text === 'string') {
        const match = fileContentRegex.exec(part.text);
        if (match) {
          const filePathSpecInContent = match[1];
          const fileActualContent = match[2].trim();
          processedQueryParts.push({
            text: `\nContent from @${filePathSpecInContent}:\n`,
          });
          processedQueryParts.push({ text: fileActualContent });
        } else {
          processedQueryParts.push({ text: part.text });
        }
      } else {
        processedQueryParts.push(part);
      }
    }
  }

  private appendEmbeddedContext(
    processedQueryParts: Part[],
    embeddedContext: acp.EmbeddedResourceResource[],
  ): void {
    processedQueryParts.push({
      text: '\n--- Content from referenced context ---',
    });

    for (const contextPart of embeddedContext) {
      processedQueryParts.push({
        text: `\nContent from @${contextPart.uri}:\n`,
      });
      if ('text' in contextPart) {
        processedQueryParts.push({
          text: contextPart.text,
        });
      } else {
        processedQueryParts.push({
          inlineData: {
            mimeType: contextPart.mimeType ?? 'application/octet-stream',
            data: contextPart.blob,
          },
        });
      }
    }
  }
}
