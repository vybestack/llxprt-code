/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SchemaValidator } from '../utils/schemaValidator.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolInvocation,
  ToolResult,
} from './tools.js';
import { GenerateContentResponse } from '@google/genai';
import { getErrorMessage } from '../utils/errors.js';
import { ApprovalMode, Config } from '../config/config.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { fetchWithTimeout, isPrivateIp } from '../utils/fetch.js';
import { convert } from 'html-to-text';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const URL_FETCH_TIMEOUT_MS = 10000;
const MAX_CONTENT_LENGTH = 100000;

// Helper function to extract URLs from a string
function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

// Interfaces for grounding metadata (similar to web-search.ts)
interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
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

class WebFetchToolInvocation extends BaseToolInvocation<
  WebFetchToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: WebFetchToolParams,
  ) {
    super(params);
  }

  private async executeFallback(_signal: AbortSignal): Promise<ToolResult> {
    const urls = extractUrls(this.params.prompt);
    if (urls.length === 0) {
      return {
        llmContent: 'Error: No URL found in the prompt for fallback.',
        returnDisplay: 'Error: No URL found in the prompt for fallback.',
      };
    }
    // For now, we only support one URL for fallback
    let url = urls[0];

    // Convert GitHub blob URL to raw URL
    if (url.includes('github.com') && url.includes('/blob/')) {
      url = url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    try {
      const response = await fetchWithTimeout(url, URL_FETCH_TIMEOUT_MS);
      const html = await response.text();
      const textContent = convert(html, {
        wordwrap: 130,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
        ],
      }).substring(0, MAX_CONTENT_LENGTH);

      // In llxprt, we can't use Gemini client directly for fallback processing
      // Return the raw content with a note about the limitation
      return {
        llmContent: `Private/local URLs cannot be processed with AI. Raw content provided below.\n\nContent from ${url}:\n\n${textContent.substring(0, 5000)}${textContent.length > 5000 ? '...[truncated]' : ''}`,
        returnDisplay: `Private/local URLs cannot be processed with AI. Raw content provided below.`,
      };
    } catch (e) {
      const error = e as Error;
      const errorMessage = `Error during fallback fetch for ${url}: ${error.message}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  getDescription(): string {
    const displayPrompt =
      this.params.prompt.length > 100
        ? this.params.prompt.substring(0, 97) + '...'
        : this.params.prompt;
    return `Processing URLs and instructions from prompt: "${displayPrompt}"`;
  }

  override async shouldConfirmExecute(): Promise<
    ToolCallConfirmationDetails | false
  > {
    const approvalMode = this.config.getApprovalMode();
    if (
      approvalMode === ApprovalMode.AUTO_EDIT ||
      approvalMode === ApprovalMode.YOLO
    ) {
      return false;
    }

    // Perform GitHub URL conversion here to differentiate between user-provided
    // URL and the actual URL to be fetched.
    const urls = extractUrls(this.params.prompt).map((url) => {
      if (url.includes('github.com') && url.includes('/blob/')) {
        return url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }
      return url;
    });

    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Web Fetch`,
      prompt: this.params.prompt,
      urls,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const userPrompt = this.params.prompt;
    const urls = extractUrls(userPrompt);
    const url = urls[0];
    const isPrivate = isPrivateIp(url);

    if (isPrivate) {
      return this.executeFallback(signal);
    }

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

    // Check if the provider supports web_fetch
    const serverTools = serverToolsProvider.getServerTools();
    if (!serverTools.includes('web_fetch')) {
      return {
        llmContent: `Web fetch is not available. The server tools provider does not support web fetch.`,
        returnDisplay: `Web fetch not available.`,
      };
    }

    try {
      // Invoke the server tool
      const response = await serverToolsProvider.invokeServerTool(
        'web_fetch',
        { prompt: this.params.prompt },
        { signal },
      );

      if (process.env.DEBUG) {
        console.log(
          '[WEB-FETCH] Raw response:',
          JSON.stringify(response, null, 2),
        );
      }

      // Cast response to expected type for better type safety
      const geminiResponse = response as GenerateContentResponse;

      // Check if response has the expected structure
      if (
        !geminiResponse.candidates ||
        geminiResponse.candidates.length === 0
      ) {
        return {
          llmContent: `Error: The backend API did not return any response candidates. This may indicate an issue with the urlContext tool configuration.`,
          returnDisplay: 'No response from backend API.',
        };
      }

      // Remove the error checking - just let the LLM's response through
      // The LLM is smart enough to handle failures appropriately

      // Extract text using utility function
      const responseText = getResponseText(geminiResponse);

      // Simple check - if no text, return error
      if (!responseText || !responseText.trim()) {
        return {
          llmContent: `No content found for the provided URL(s). The site may have blocked access or returned empty content.`,
          returnDisplay: 'No content found.',
        };
      }

      // Process grounding metadata (geminiResponse already cast above)
      const groundingMetadata =
        geminiResponse.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      let modifiedResponseText = responseText;
      const sourceListFormatted: string[] = [];

      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'Unknown URI';
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

          insertions.sort((a, b) => b.index - a.index);
          insertions.forEach(({ index, marker }) => {
            modifiedResponseText =
              modifiedResponseText.slice(0, index) +
              marker +
              modifiedResponseText.slice(index);
          });
        }
      }

      // Prepare the final response
      const finalResponse = sourceListFormatted.length
        ? `${modifiedResponseText}\n\n### Sources:\n${sourceListFormatted.join('\n')}`
        : modifiedResponseText;

      return {
        llmContent: finalResponse,
        returnDisplay: finalResponse,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (process.env.DEBUG) {
        console.error('[WEB-FETCH] Error:', error);
      }
      return {
        llmContent: `Error during web fetch: ${errorMessage}`,
        returnDisplay: `Error during web fetch: ${errorMessage}`,
      };
    }
  }
}

/**
 * Implementation of the WebFetch tool logic
 */
export class WebFetchTool extends BaseDeclarativeTool<
  WebFetchToolParams,
  ToolResult
> {
  static readonly Name: string = 'web_fetch';

  constructor(private readonly config: Config) {
    super(
      WebFetchTool.Name,
      'WebFetch',
      "Processes content from URL(s), including local and private network addresses (e.g., localhost), embedded in a prompt. Include up to 20 URLs and instructions (e.g., summarize, extract specific data) directly in the 'prompt' parameter.",
      Kind.Fetch,
      {
        properties: {
          prompt: {
            description:
              'A comprehensive prompt that includes the URL(s) (up to 20) to fetch and specific instructions on how to process their content (e.g., "Summarize https://example.com/article and extract key points from https://another.com/data"). Must contain as least one URL starting with http:// or https://.',
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    );
    const proxy = config.getProxy();
    if (proxy) {
      setGlobalDispatcher(new ProxyAgent(proxy as string));
    }
  }

  protected override validateToolParams(
    params: WebFetchToolParams,
  ): string | null {
    const errors = SchemaValidator.validate(
      this.schema.parametersJsonSchema,
      params,
    );
    if (errors) {
      return errors;
    }
    if (!params.prompt || params.prompt.trim() === '') {
      return "The 'prompt' parameter cannot be empty and must contain URL(s) and instructions.";
    }
    if (
      !params.prompt.includes('http://') &&
      !params.prompt.includes('https://')
    ) {
      return "The 'prompt' must contain at least one valid URL (starting with http:// or https://).";
    }
    return null;
  }

  protected createInvocation(
    params: WebFetchToolParams,
  ): ToolInvocation<WebFetchToolParams, ToolResult> {
    return new WebFetchToolInvocation(this.config, params);
  }
}
