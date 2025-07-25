/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GroundingMetadata, GenerateContentResponse } from '@google/genai';
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
 * Parameters for the WebFetch tool
 */
export interface WebFetchToolParams {
  /**
   * The prompt containing URL(s) (up to 20) and instructions for processing their content.
   */
  prompt: string;
}

/**
 * Extends ToolResult to include sources for web fetch.
 */
export interface WebFetchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

/**
 * A tool to fetch and process web content using the Gemini API.
 */
export class WebFetchTool extends BaseTool<
  WebFetchToolParams,
  WebFetchToolResult
> {
  static readonly Name: string = 'web_fetch';

  constructor(private readonly config: Config) {
    super(
      WebFetchTool.Name,
      'WebFetch',
      'Fetches and processes content from URL(s) embedded in a prompt using the Gemini API. Include up to 20 URLs and instructions for processing their content.',
      Icon.Globe,
      {
        type: Type.OBJECT,
        properties: {
          prompt: {
            type: Type.STRING,
            description:
              'A prompt that includes URL(s) (up to 20) to fetch and instructions on how to process their content.',
          },
        },
        required: ['prompt'],
      },
    );
  }

  /**
   * Validates the parameters for the WebFetchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */

  validateParams(params: WebFetchToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.prompt || params.prompt.trim() === '') {
      return "The 'prompt' parameter cannot be empty.";
    }

    if (
      !params.prompt.includes('http://') &&
      !params.prompt.includes('https://')
    ) {
      return "The 'prompt' must contain at least one valid URL (starting with http:// or https://).";
    }
    return null;
  }

  getDescription(params: WebFetchToolParams): string {
    const displayPrompt =
      params.prompt.length > 100
        ? params.prompt.substring(0, 97) + '...'
        : params.prompt;
    return `Processing URLs and instructions from prompt: "${displayPrompt}"`;
  }

  async execute(
    params: WebFetchToolParams,
    signal: AbortSignal,
  ): Promise<WebFetchToolResult> {
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
          llmContent: `Web fetch requires a provider. Please use --provider gemini with authentication.`,
          returnDisplay: 'Web fetch requires a provider.',
        };
      }

      // Use serverToolsProvider for web fetch
      const serverToolsProvider =
        contentGenConfig.providerManager.getServerToolsProvider();
      if (!serverToolsProvider) {
        return {
          llmContent: `Web fetch requires Gemini provider to be configured. Please ensure Gemini is available with authentication.`,
          returnDisplay: 'Web fetch requires Gemini provider.',
        };
      }

      // Check if the provider supports url_context
      const serverTools = serverToolsProvider.getServerTools();
      if (!serverTools.includes('url_context')) {
        return {
          llmContent: `Web fetch is not available. The server tools provider does not support URL context.`,
          returnDisplay: `Web fetch not available.`,
        };
      }

      // Invoke the server tool
      const response = await serverToolsProvider.invokeServerTool(
        'url_context',
        { prompt: params.prompt },
        { signal },
      );

      // Cast response to the expected type
      const geminiResponse = response as GenerateContentResponse;
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
          llmContent: `No content or information found for prompt: "${params.prompt}"`,
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
        llmContent: `Web fetch results for "${params.prompt}":\n\n${modifiedResponseText}`,
        returnDisplay: `Fetch results for "${params.prompt}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during web fetch for prompt "${params.prompt}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web fetch.`,
      };
    }
  }
}
