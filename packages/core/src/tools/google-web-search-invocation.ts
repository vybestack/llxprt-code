/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type GenerateContentResponse,
  type GroundingMetadata,
} from '@google/genai';
import { BaseToolInvocation, type ToolResult } from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { GOOGLE_WEB_SEARCH_TOOL } from './tool-names.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { ToolErrorType } from './tool-error.js';
import { debugLogger } from '../utils/debugLogger.js';

type ServerToolsProvider = {
  getServerTools: () => string[];
  invokeServerTool: (
    name: string,
    params: { query: string },
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
};

type GeminiWebSearchResponse = {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: GroundingChunkItem[];
      groundingSupports?: GroundingSupportItem[];
    };
  }>;
};

export interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

export interface GroundingChunkItem {
  web?: GroundingChunkWeb;
  // Other properties might exist if needed in the future
}

export interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string; // text is optional as per the example
}

export interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[]; // Optional as per example
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  /**
   * The search query.
   */

  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

/**
 * Tool invocation for performing web searches using Google Search via the Gemini API.
 */
export class GoogleWebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  constructor(
    private readonly config: Config,
    params: WebSearchToolParams,
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  override getToolName(): string {
    return GOOGLE_WEB_SEARCH_TOOL;
  }

  override getDescription(): string {
    return `Searching the web for: "${this.params.query}"`;
  }

  async execute(signal: AbortSignal): Promise<WebSearchToolResult> {
    const invalidQueryResult = this.validateQuery();
    if (invalidQueryResult) return invalidQueryResult;

    try {
      const serverToolsProvider = this.getServerToolsProvider();
      if (serverToolsProvider instanceof Error) {
        return this.createProviderErrorResult(serverToolsProvider.message);
      }

      const searchQuery = this.params.query.trim();
      if (searchQuery === '') return this.createEmptyQueryResult();

      const response = await serverToolsProvider.invokeServerTool(
        'web_search',
        { query: searchQuery },
        { signal },
      );

      return this.formatSearchResponse(response);
    } catch (error: unknown) {
      return this.createSearchErrorResult(error);
    }
  }

  private validateQuery(): WebSearchToolResult | undefined {
    if (
      !this.params.query ||
      this.params.query.trim() === '' ||
      this.params.query === 'undefined'
    ) {
      return {
        llmContent: `Error: Web search requires a valid search query. Please provide a specific search query.`,
        returnDisplay: `Error: No valid search query provided.`,
      };
    }
    return undefined;
  }

  private createEmptyQueryResult(): WebSearchToolResult {
    return {
      llmContent: `Error: Cannot perform web search without a query.`,
      returnDisplay: `Error: Empty search query.`,
    };
  }

  private getServerToolsProvider(): ServerToolsProvider | Error {
    const contentGenConfig = this.config.getContentGeneratorConfig();
    if (!contentGenConfig?.providerManager) return new Error('provider');

    const serverToolsProvider =
      contentGenConfig.providerManager.getServerToolsProvider();
    if (!serverToolsProvider) return new Error('gemini');

    const serverTools = serverToolsProvider.getServerTools();
    if (!serverTools.includes('web_search')) return new Error('unsupported');

    return serverToolsProvider;
  }

  private createProviderErrorResult(message: string): WebSearchToolResult {
    if (message === 'provider') return this.createMissingProviderResult();
    if (message === 'gemini') return this.createMissingGeminiResult();
    return this.createUnsupportedServerToolResult();
  }

  private createMissingProviderResult(): WebSearchToolResult {
    return {
      llmContent: `Web search requires a provider. Please use --provider gemini with authentication.`,
      returnDisplay: 'Web search requires a provider.',
    };
  }

  private createMissingGeminiResult(): WebSearchToolResult {
    return {
      llmContent: `Web search requires Gemini provider to be configured. Please ensure Gemini is available with authentication.`,
      returnDisplay: 'Web search requires Gemini provider.',
    };
  }

  private createUnsupportedServerToolResult(): WebSearchToolResult {
    return {
      llmContent: `Web search is not available. The server tools provider does not support web search.`,
      returnDisplay: `Web search not available.`,
    };
  }

  private formatSearchResponse(response: unknown): WebSearchToolResult {
    const geminiResponse = response as GeminiWebSearchResponse;
    const responseText = getResponseText(response as GenerateContentResponse);
    const groundingMetadata = geminiResponse.candidates?.[0]?.groundingMetadata;
    const sources = groundingMetadata?.groundingChunks;
    const groundingSupports = groundingMetadata?.groundingSupports;

    if (!responseText?.trim()) {
      return {
        llmContent: `No search results or information found for query: "${this.params.query}"`,
        returnDisplay: 'No information found.',
      };
    }

    const modifiedResponseText = this.addSourcesToResponse(
      responseText,
      sources,
      groundingSupports,
    );
    return {
      llmContent: `Web search results for "${this.params.query}":\n\n${modifiedResponseText}`,
      returnDisplay: `Search results for "${this.params.query}" returned.`,
      sources,
    };
  }

  private addSourcesToResponse(
    responseText: string,
    sources?: GroundingChunkItem[],
    groundingSupports?: GroundingSupportItem[],
  ): string {
    if (sources === undefined || sources.length === 0) return responseText;

    let modifiedResponseText = this.insertCitationMarkers(
      responseText,
      groundingSupports,
    );
    const sourceListFormatted = this.formatSources(sources);
    if (sourceListFormatted.length > 0) {
      modifiedResponseText += '\n\nSources:\n' + sourceListFormatted.join('\n');
    }
    return modifiedResponseText;
  }

  private formatSources(sources: GroundingChunkItem[]): string[] {
    return sources.map((source, index) => {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty title should show 'Untitled'
      const title = source.web?.title || 'Untitled';
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty URI should show 'No URI'
      const uri = source.web?.uri || 'No URI';
      return `[${index + 1}] ${title} (${uri})`;
    });
  }

  private insertCitationMarkers(
    responseText: string,
    groundingSupports?: GroundingSupportItem[],
  ): string {
    if (groundingSupports === undefined || groundingSupports.length === 0) {
      return responseText;
    }

    const textBuffer = Buffer.from(responseText, 'utf-8');
    const insertions = this.getCitationInsertions(
      groundingSupports,
      textBuffer,
    );
    const responseChars = responseText.split('');
    for (const insertion of insertions) {
      responseChars.splice(insertion.index, 0, insertion.marker);
    }
    return responseChars.join('');
  }

  private getCitationInsertions(
    groundingSupports: GroundingSupportItem[],
    textBuffer: Buffer,
  ): Array<{ index: number; marker: string }> {
    const insertions: Array<{ index: number; marker: string }> = [];
    for (const support of groundingSupports) {
      if (!support.segment || !support.groundingChunkIndices) continue;
      const citationMarker = support.groundingChunkIndices
        .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
        .join('');
      const charIndex = textBuffer
        .subarray(0, support.segment.endIndex)
        .toString('utf-8').length;
      insertions.push({ index: charIndex, marker: citationMarker });
    }
    return insertions.sort((a, b) => b.index - a.index);
  }

  private createSearchErrorResult(error: unknown): WebSearchToolResult {
    const queryDisplay = this.params.query || 'undefined';
    const errorMessage = `Error during web search for query "${queryDisplay}": ${getErrorMessage(error)}`;
    debugLogger.error(errorMessage, error);
    return {
      llmContent: `Error: ${errorMessage}`,
      returnDisplay: `Error performing web search.`,
      error: {
        type: ToolErrorType.WEB_SEARCH_FAILED,
        message: `Web search failed: ${getErrorMessage(error)}`,
      },
    };
  }
}
