/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { GOOGLE_WEB_FETCH_TOOL } from './tool-names.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { fetchWithTimeout, isPrivateIp } from '../utils/fetch.js';
import { convert } from 'html-to-text';
// import { ProxyAgent, setGlobalDispatcher } from 'undici';
import type { GenerateContentResponse, UrlMetadata } from '@google/genai';
import { DebugLogger } from '../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:tools:web-fetch');
const URL_FETCH_TIMEOUT_MS = 10000;
const MAX_CONTENT_LENGTH = 100000;

/**
 * Parses a prompt to extract valid URLs and identify malformed ones.
 * Strips common trailing punctuation from tokens before URL validation.
 */
export function parsePrompt(text: string): {
  validUrls: string[];
  errors: string[];
} {
  const tokens = text.split(/\s+/);
  const validUrls: string[] = [];
  const errors: string[] = [];

  const stripTrailingPunctuation = (input: string): string => {
    let endIndex = input.length;
    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    while (endIndex > 0) {
      const lastChar = input[endIndex - 1];
      if (
        // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        lastChar === '.' ||
        lastChar === ',' ||
        lastChar === ';' ||
        lastChar === ':' ||
        lastChar === '!' ||
        lastChar === '?'
      ) {
        endIndex--;
        continue;
      }
      break;
    }
    return input.slice(0, endIndex);
  };

  for (const token of tokens) {
    if (!token) continue;

    // Heuristic to check if the token appears to contain URL-like chars.
    if (token.includes('://')) {
      // Strip common trailing punctuation (period, comma, semicolon, colon, etc.)
      // This handles natural language like "Check https://example.com."
      const cleaned = stripTrailingPunctuation(token);

      try {
        // Validate with new URL()
        const url = new URL(cleaned);

        // Allowlist protocols
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (['http:', 'https:'].includes(url.protocol)) {
          validUrls.push(url.href);
        } else {
          errors.push(
            `Unsupported protocol in URL: "${cleaned}". Only http and https are supported.`,
          );
        }
      } catch {
        // Malformed URL according to WHATWG standard.
        errors.push(`Malformed URL detected: "${cleaned}".`);
      }
    }
  }

  return { validUrls, errors };
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

type ServerToolsProvider = {
  getServerTools: () => string[];
  invokeServerTool: (
    name: string,
    params: { prompt: string },
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
};

/**
 * Parameters for the WebFetch tool
 */
export interface GoogleWebFetchToolParams {
  /**
   * The prompt containing URL(s) (up to 20) and instructions for processing their content.
   */
  prompt: string;
}

class GoogleWebFetchToolInvocation extends BaseToolInvocation<
  GoogleWebFetchToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: GoogleWebFetchToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  override getToolName(): string {
    return GoogleWebFetchTool.Name;
  }

  private async executeFallback(_signal: AbortSignal): Promise<ToolResult> {
    const { validUrls: urls } = parsePrompt(this.params.prompt);
    // For now, we only support one URL for fallback
    let url = urls[0];

    // Convert GitHub blob URL to raw URL
    // Convert GitHub blob URL to raw URL
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === 'github.com' && url.includes('/blob/')) {
        url = url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }
    } catch {
      // Invalid URL; fetchWithTimeout will handle the error.
    }

    try {
      const response = await fetchWithTimeout(
        url,
        URL_FETCH_TIMEOUT_MS,
        _signal,
      );
      if (!response.ok) {
        throw new Error(
          `Request failed with status code ${response.status} ${response.statusText}`,
        );
      }
      const rawContent = await response.text();
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: get() returns string | null, empty string should fall through
      const contentType = response.headers.get('content-type') || '';
      let textContent: string;

      // Only use html-to-text if content type is HTML, or if no content type is provided (assume HTML)
      if (
        contentType.toLowerCase().includes('text/html') ||
        contentType === ''
      ) {
        textContent = convert(rawContent, {
          wordwrap: false,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        });
      } else {
        // For other content types (text/plain, application/json, etc.), use raw text
        textContent = rawContent;
      }

      textContent = textContent.substring(0, MAX_CONTENT_LENGTH);

      // For private URLs in llxprt, we return raw content without AI processing
      // This preserves our multi-provider approach
      return {
        llmContent: textContent,
        returnDisplay: `Content for ${url} fetched directly.`,
      };
    } catch (e) {
      const error = e as Error;
      const errorMessage = `Error during fallback fetch for ${url}: ${error.message}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_FETCH_FALLBACK_FAILED,
        },
      };
    }
  }

  override getDescription(): string {
    const displayPrompt =
      this.params.prompt.length > 100
        ? this.params.prompt.substring(0, 97) + '...'
        : this.params.prompt;
    return `Processing URLs and instructions from prompt: "${displayPrompt}"`;
  }

  override async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Try policy/message bus first when available.
    if (this.messageBus) {
      const decision = await this.getMessageBusDecision(abortSignal);
      if (decision === 'ALLOW') {
        return false;
      }
      if (decision === 'DENY') {
        throw new Error('Tool execution denied by policy.');
      }
      // if 'ASK_USER', fall through to legacy confirmation UI
    }

    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    // Perform GitHub URL conversion here to differentiate between user-provided
    // URL and the actual URL to be fetched.
    const { validUrls } = parsePrompt(this.params.prompt);
    const urls = validUrls.map((url) => {
      try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'github.com' && url.includes('/blob/')) {
          return url
            .replace('github.com', 'raw.githubusercontent.com')
            .replace('/blob/', '/');
        }
      } catch {
        // Invalid URL; return as-is for error handling downstream.
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
          // No need to publish a policy update as the default policy for
          // AUTO_EDIT already reflects always approving web-fetch.
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        } else {
          await this.publishPolicyUpdate(outcome);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const userPrompt = this.params.prompt;
    const { validUrls: urls } = parsePrompt(userPrompt);
    const url = urls[0];

    if (isPrivateIp(url)) return this.executePrivateUrlFallback(signal, url);

    const serverToolsProvider = this.getServerToolsProvider();
    if (serverToolsProvider instanceof Error) {
      return this.createProviderErrorResult(serverToolsProvider.message);
    }

    try {
      const response = await this.invokeWebFetch(
        serverToolsProvider,
        userPrompt,
        signal,
      );
      return await this.formatServerResponse(response, userPrompt, signal, url);
    } catch (error: unknown) {
      return this.createProcessingErrorResult(error);
    }
  }

  private async executePrivateUrlFallback(
    signal: AbortSignal,
    url: string,
  ): Promise<ToolResult> {
    const errorMessage =
      'Private/local URLs cannot be processed with AI analysis. Processing content directly.';
    const result = await this.executeFallback(signal);
    return {
      ...result,
      llmContent: `${errorMessage}\n\nContent from ${url}:\n\n${result.llmContent}`,
    };
  }

  private getServerToolsProvider(): ServerToolsProvider | Error {
    const providerManager =
      this.config.getContentGeneratorConfig()?.providerManager;
    if (!providerManager) return new Error('provider');

    const serverToolsProvider = providerManager.getServerToolsProvider();
    if (!serverToolsProvider) return new Error('gemini');

    const supportedTools = serverToolsProvider.getServerTools();
    if (!supportedTools.includes(GOOGLE_WEB_FETCH_TOOL)) {
      return new Error('unsupported');
    }

    return serverToolsProvider;
  }

  private createProviderErrorResult(message: string): ToolResult {
    if (message === 'provider') return this.createMissingProviderResult();
    if (message === 'gemini') return this.createMissingGeminiResult();
    return this.createUnsupportedServerToolResult();
  }

  private createMissingProviderResult(): ToolResult {
    return {
      llmContent:
        'Web fetch requires a provider. Please use --provider gemini with authentication.',
      returnDisplay: 'Web fetch requires a provider.',
      error: {
        message: 'No provider manager available',
        type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
      },
    };
  }

  private createMissingGeminiResult(): ToolResult {
    return {
      llmContent:
        'Web fetch requires Gemini provider to be configured. Please ensure Gemini is available with authentication.',
      returnDisplay: 'Web fetch requires Gemini provider.',
      error: {
        message: 'No server tools provider available',
        type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
      },
    };
  }

  private createUnsupportedServerToolResult(): ToolResult {
    return {
      llmContent:
        'Web fetch is not available. The server tools provider does not support web fetch.',
      returnDisplay: 'Web fetch not available.',
      error: {
        message: 'Server tools provider does not support web_fetch',
        type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
      },
    };
  }

  private async invokeWebFetch(
    serverToolsProvider: ServerToolsProvider,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await serverToolsProvider.invokeServerTool(
      'web_fetch',
      { prompt: userPrompt },
      { signal },
    );
    logger.log(
      `Full response for prompt "${userPrompt.substring(0, 50)}...":`,
      JSON.stringify(response, null, 2),
    );
    return response;
  }

  private async formatServerResponse(
    response: unknown,
    userPrompt: string,
    signal: AbortSignal,
    url: string,
  ): Promise<ToolResult> {
    const typedResponse = response as GenerateContentResponse;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: getResponseText returns string | null | undefined, empty string should fall through
    let responseText = getResponseText(typedResponse) || '';
    const groundingMetadata = typedResponse.candidates?.[0]?.groundingMetadata;
    const sources = groundingMetadata?.groundingChunks as
      | GroundingChunkItem[]
      | undefined;
    const groundingSupports = groundingMetadata?.groundingSupports as
      | GroundingSupportItem[]
      | undefined;

    if (this.hasProcessingError(typedResponse, responseText, sources)) {
      if (isPrivateIp(url)) return this.executeFallback(signal);
      return {
        llmContent: 'No content found or URL retrieval failed.',
        returnDisplay: 'No content found.',
      };
    }

    responseText = this.addSourcesToResponse(
      responseText,
      sources,
      groundingSupports,
    );
    logger.log(
      `Formatted tool response for prompt "${userPrompt}:\n\n":`,
      responseText,
    );

    return {
      llmContent: responseText,
      returnDisplay: responseText,
    };
  }

  private hasProcessingError(
    response: GenerateContentResponse,
    responseText: string,
    sources?: GroundingChunkItem[],
  ): boolean {
    const urlMetadata =
      response.candidates?.[0]?.urlContextMetadata?.urlMetadata;
    if (urlMetadata !== undefined && urlMetadata.length > 0) {
      return urlMetadata.every(
        (metadata: UrlMetadata) =>
          // eslint-disable-next-line sonarjs/different-types-comparison -- Generated Gemini enum typing is narrower than runtime URL retrieval statuses; preserve the original success-status comparison.
          metadata.urlRetrievalStatus !== 'URL_RETRIEVAL_STATUS_SUCCESS',
      );
    }

    if (responseText.trim()) return false;
    return sources === undefined || sources.length === 0;
  }

  private addSourcesToResponse(
    responseText: string,
    sources?: GroundingChunkItem[],
    groundingSupports?: GroundingSupportItem[],
  ): string {
    if (sources === undefined || sources.length === 0) return responseText;

    let updatedText = this.insertCitationMarkers(
      responseText,
      groundingSupports,
    );
    const sourceListFormatted = this.formatSources(sources);
    if (sourceListFormatted.length > 0) {
      updatedText += `\n\nSources:\n${sourceListFormatted.join('\n')}`;
    }
    return updatedText;
  }

  private formatSources(sources: GroundingChunkItem[]): string[] {
    return sources.map((source: GroundingChunkItem, index: number) => {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: title is optional string, empty string should fall through
      const title = source.web?.title || 'Untitled';
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: uri is optional string, empty string should fall through
      const uri = source.web?.uri || 'Unknown URI';
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

    const insertions = this.getCitationInsertions(groundingSupports);
    const responseChars = responseText.split('');
    for (const insertion of insertions) {
      responseChars.splice(insertion.index, 0, insertion.marker);
    }
    return responseChars.join('');
  }

  private getCitationInsertions(
    groundingSupports: GroundingSupportItem[],
  ): Array<{ index: number; marker: string }> {
    const insertions: Array<{ index: number; marker: string }> = [];
    for (const support of groundingSupports) {
      if (!support.segment || !support.groundingChunkIndices) continue;
      const citationMarker = support.groundingChunkIndices
        .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
        .join('');
      insertions.push({
        index: support.segment.endIndex,
        marker: citationMarker,
      });
    }
    return insertions.sort((a, b) => b.index - a.index);
  }

  private createProcessingErrorResult(error: unknown): ToolResult {
    const errorMessage = `Error during web fetch: ${getErrorMessage(error)}`;
    logger.error(errorMessage, error);
    return {
      llmContent: `Error: ${errorMessage}`,
      returnDisplay: `Error: ${errorMessage}`,
      error: {
        message: errorMessage,
        type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
      },
    };
  }
}

/**
 * Implementation of the WebFetch tool logic
 */
export class GoogleWebFetchTool extends BaseDeclarativeTool<
  GoogleWebFetchToolParams,
  ToolResult
> {
  static readonly Name: string = 'google_web_fetch';

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      GoogleWebFetchTool.Name,
      'GoogleWebFetch',
      "Processes content from URL(s), including local and private network addresses (e.g., localhost), embedded in a prompt. Include up to 20 URLs and instructions (e.g., summarize, extract specific data) directly in the 'prompt' parameter.",
      Kind.Fetch,
      {
        properties: {
          prompt: {
            description:
              'A comprehensive prompt that includes the URL(s) (up to 20) to fetch and specific instructions on how to process their content (e.g., "Summarize https://example.com/article and extract key points from https://another.com/data"). All URLs to be fetched must be valid and complete, starting with "http://" or "https://", and be fully-formed with a valid hostname (e.g., a domain name like "example.com" or an IP address). For example, "https://example.com" is valid, but "example.com" is not.',
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
      false, // output is not markdown
      false, // output cannot be updated
      messageBus,
    );
    // Proxy is now set globally in Config constructor with error handling
  }

  protected override validateToolParamValues(
    params: GoogleWebFetchToolParams,
  ): string | null {
    if (!params.prompt || params.prompt.trim() === '') {
      return "The 'prompt' parameter cannot be empty and must contain URL(s) and instructions.";
    }

    const { validUrls, errors } = parsePrompt(params.prompt);

    if (errors.length > 0) {
      return `Error(s) in prompt URLs:\n- ${errors.join('\n- ')}`;
    }

    if (validUrls.length === 0) {
      return "The 'prompt' must contain at least one valid URL (starting with http:// or https://).";
    }

    return null;
  }

  protected createInvocation(
    params: GoogleWebFetchToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ): ToolInvocation<GoogleWebFetchToolParams, ToolResult> {
    return new GoogleWebFetchToolInvocation(
      this.config,
      params,
      messageBus,
      toolName ?? this.name,
      displayName ?? this.displayName,
    );
  }
}
