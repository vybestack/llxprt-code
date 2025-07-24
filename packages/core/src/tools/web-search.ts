/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GroundingMetadata } from '@google/genai';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';

import { getErrorMessage } from '../utils/errors.js';
import { Config } from '../config/config.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
  // Other properties might exist if needed in the future
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string; // text is optional as per the example
}

interface GroundingSupportItem {
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
 * A tool to perform web searches using Google Search via the Gemini API.
 */
export class WebSearchTool extends BaseTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name: string = 'google_web_search';

  constructor(private readonly config: Config) {
    super(
      WebSearchTool.Name,
      'GoogleSearch',
      'Performs a web search using Google Search (via the Gemini API) and returns the results. This tool is useful for finding information on the internet based on a query.',
      Icon.Globe,
      {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'The search query to find information on the web.',
          },
        },
        required: ['query'],
      },
    );
  }

  /**
   * Validates the parameters for the WebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  validateParams(params: WebSearchToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  getDescription(params: WebSearchToolParams): string {
    return `Searching the web for: "${params.query}"`;
  }

  async execute(
    params: WebSearchToolParams,
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
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

      // Invoke the server tool
      const response = await serverToolsProvider.invokeServerTool(
        'web_search',
        { query: params.query },
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
          llmContent: `No search results or information found for query: "${params.query}"`,
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
          const insertions: Array<{ index: number; marker: string }> = [];
          groundingSupports.forEach((support: GroundingSupportItem) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');
              insertions.push({
                index: support.segment.endIndex,
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
        llmContent: `Web search results for "${params.query}":\n\n${modifiedResponseText}`,
        returnDisplay: `Search results for "${params.query}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${params.query}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
      };
    }
  }
}
