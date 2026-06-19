/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GroundingMetadata } from '@google/genai';

import type {
  IWebSearchService,
  IToolMessageBus,
} from '../interfaces/index.js';
import { GOOGLE_WEB_SEARCH_TOOL } from '../types/tool-names.js';
import { ToolErrorType } from '../types/tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';
import { BaseToolInvocation, type ToolResult } from './tools.js';

type GeminiWebSearchResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        thoughtSignature?: string;
      }>;
    };
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
}

export interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
}

export interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

export interface WebSearchToolParams {
  query: string;
}

export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

export class GoogleWebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  constructor(
    private readonly webSearchService: IWebSearchService,
    params: WebSearchToolParams,
    messageBus?: IToolMessageBus,
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

  private getServerToolsProvider():
    | NonNullable<ReturnType<IWebSearchService['getServerToolsProvider']>>
    | Error {
    const serverToolsProvider = this.webSearchService.getServerToolsProvider();
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
    const responseText = getResponseText(geminiResponse);
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
      const title = stringOrDefault(source.web?.title, 'Untitled');
      const uri = stringOrDefault(source.web?.uri, 'No URI');
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

function getResponseText(
  response: GeminiWebSearchResponse,
): string | undefined {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) return undefined;

  const textSegments = parts
    .filter(
      (part) => part.thought !== true && part.thoughtSignature === undefined,
    )
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  return textSegments.length > 0 ? textSegments.join('') : undefined;
}
