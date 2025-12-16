/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type GroundingMetadata } from '@google/genai';
import { BaseToolInvocation, type ToolResult } from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { getErrorMessage } from '../utils/errors.js';
import { Config } from '../config/config.js';
import { GOOGLE_WEB_SEARCH_TOOL } from './tool-names.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { ToolErrorType } from './tool-error.js';

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
    messageBus?: MessageBus,
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
    // Additional safety check - ensure query exists and is not just "undefined" string
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

    try {
      // Get the content generator config to access the provider manager
      const contentGenConfig = this.config.getContentGeneratorConfig();

      // Get the serverToolsProvider from the provider manager
      if (!contentGenConfig?.providerManager) {
        return {
          llmContent: `Web search requires a provider. Please use --provider gemini with authentication.`,
          returnDisplay: 'Web search requires a provider.',
        };
      }

      // Use serverToolsProvider for web search
      const serverToolsProvider =
        contentGenConfig.providerManager.getServerToolsProvider();
      if (!serverToolsProvider) {
        return {
          llmContent: `Web search requires Gemini provider to be configured. Please ensure Gemini is available with authentication.`,
          returnDisplay: 'Web search requires Gemini provider.',
        };
      }

      // Check if the provider supports web_search
      const serverTools = serverToolsProvider.getServerTools();
      if (!serverTools.includes('web_search')) {
        return {
          llmContent: `Web search is not available. The server tools provider does not support web search.`,
          returnDisplay: `Web search not available.`,
        };
      }

      // Invoke the server tool with validated query
      // Double-check query is not undefined before sending
      const searchQuery = this.params.query?.trim() || '';
      if (!searchQuery) {
        return {
          llmContent: `Error: Cannot perform web search without a query.`,
          returnDisplay: `Error: Empty search query.`,
        };
      }

      const response = await serverToolsProvider.invokeServerTool(
        'web_search',
        { query: searchQuery },
        { signal },
      );

      // Cast response to the expected type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geminiResponse = response as any;
      const responseText = getResponseText(geminiResponse);
      const groundingMetadata =
        geminiResponse?.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      if (!responseText || !responseText.trim()) {
        return {
          llmContent: `No search results or information found for query: "${this.params.query}"`,
          returnDisplay: 'No information found.',
        };
      }

      let modifiedResponseText = responseText;
      const sourceListFormatted: string[] = [];

      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'No URI';
          sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
        });

        if (groundingSupports && groundingSupports.length > 0) {
          // Convert byte indices to character indices
          const textBuffer = Buffer.from(modifiedResponseText, 'utf-8');
          const insertions: Array<{ index: number; marker: string }> = [];

          groundingSupports.forEach((support: GroundingSupportItem) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');

              // Convert byte index to character index
              const byteIndex = support.segment.endIndex;
              const charIndex = textBuffer
                .subarray(0, byteIndex)
                .toString('utf-8').length;

              insertions.push({
                index: charIndex,
                marker: citationMarker,
              });
            }
          });

          // Sort insertions by index in descending order to avoid shifting subsequent indices
          insertions.sort((a, b) => b.index - a.index);

          const responseChars = modifiedResponseText.split(''); // Use new variable
          insertions.forEach((insertion) => {
            // Fixed arrow function syntax
            responseChars.splice(insertion.index, 0, insertion.marker);
          });
          modifiedResponseText = responseChars.join(''); // Assign back to modifiedResponseText
        }

        if (sourceListFormatted.length > 0) {
          modifiedResponseText +=
            '\n\nSources:\n' + sourceListFormatted.join('\n'); // Fixed string concatenation
        }
      }

      return {
        llmContent: `Web search results for "${this.params.query}":\n\n${modifiedResponseText}`,
        returnDisplay: `Search results for "${this.params.query}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      const queryDisplay = this.params.query || 'undefined';
      const errorMessage = `Error during web search for query "${queryDisplay}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
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
}
