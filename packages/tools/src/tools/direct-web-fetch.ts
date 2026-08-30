/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portions of this code are derived from opencode (https://github.com/sst/opencode)
 * Copyright (c) 2025 opencode
 * Licensed under the MIT License.
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
  type LiveOutputUpdate,
} from './tools.js';
import { DIRECT_WEB_FETCH_TOOL } from '../types/tool-names.js';
import { ToolErrorType } from '../types/tool-error.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { htmlToText } from 'html-to-text';
import TurndownService from 'turndown';
import { retryWithBackoff } from '../utils/retry.js';
import { ensureJsonSafe } from '../utils/unicodeUtils.js';
import { createByteBudget } from '../acquisition/index.js';
import {
  acquireBoundedHttpBody,
  disposeHttpResponseBody,
} from '../acquisition/bounded-http-response.js';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const FETCH_BYTE_BUDGET = createByteBudget(MAX_RESPONSE_SIZE);
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

/**
 * Every 4xx response is terminal for direct fetch. The shared retry helper also
 * retries 401, 403, and 429 for consumers whose authentication or quota state
 * can change between attempts.
 */
const TERMINAL_4XX_PREFIX = 400;
const TERMINAL_5XX_PREFIX = 500;

/** A fetched response paired with its per-attempt cancellation handle. */
interface FetchedResponse {
  readonly response: Response;
  readonly cancelRequest: () => void;
}

/** True when a status is a client error (4xx) that must not be retried. */
function isTerminal4xx(status: number): boolean {
  return status >= TERMINAL_4XX_PREFIX && status < TERMINAL_5XX_PREFIX;
}
const ACCEPT_HEADERS: Record<DirectWebFetchToolParams['format'], string> = {
  markdown:
    'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  text: 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1',
  html: 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1',
};

export interface DirectWebFetchToolParams {
  url: string;
  format: 'text' | 'markdown' | 'html';
  timeout?: number;
}

export class DirectWebFetchTool extends BaseDeclarativeTool<
  DirectWebFetchToolParams,
  ToolResult
> {
  static readonly Name = DIRECT_WEB_FETCH_TOOL;

  constructor(private readonly host: IToolHost) {
    super(
      DirectWebFetchTool.Name,
      'DirectWebFetch',
      'Fetches content from a specified URL and converts it to the requested format (text, markdown, or html).',
      Kind.Search,
      {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from',
          },
          format: {
            type: 'string',
            enum: ['text', 'markdown', 'html'],
            description:
              'The format to return the content in (text, markdown, or html)',
          },
          timeout: {
            type: 'number',
            description: 'Optional timeout in seconds (max 120)',
          },
        },
        required: ['url', 'format'],
      },
    );
  }

  protected createInvocation(
    params: DirectWebFetchToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<DirectWebFetchToolParams, ToolResult> {
    return new DirectWebFetchToolInvocation(this.host, params, messageBus);
  }
}

class DirectWebFetchToolInvocation extends BaseToolInvocation<
  DirectWebFetchToolParams,
  ToolResult
> {
  constructor(
    _host: IToolHost,
    params: DirectWebFetchToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return `Fetch content from ${this.params.url}`;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    const protocolError = this.validateUrlProtocol();
    if (protocolError) return protocolError;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.getTimeoutMs());
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);

    try {
      if (signal.aborted) return this.createAbortResult();

      const fetched = await this.fetchResponse(controller.signal);
      const content = await this.readBoundedResponse(
        fetched.response,
        controller.signal,
        fetched.cancelRequest,
      );
      const output = this.convertContent(
        content,
        stringOrDefault(
          fetched.response.headers.get('content-type') ?? undefined,
          '',
        ),
      );

      return {
        llmContent: ensureJsonSafe(output),
        returnDisplay: `Fetched ${this.params.url} as ${this.params.format}`,
      };
    } catch (error) {
      return this.createFetchErrorResult(error);
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private validateUrlProtocol(): ToolResult | undefined {
    if (
      this.params.url.startsWith('http://') ||
      this.params.url.startsWith('https://')
    ) {
      return undefined;
    }

    return {
      llmContent: 'URL must start with http:// or https://',
      returnDisplay: 'Invalid URL',
      error: {
        message: 'Invalid URL protocol',
        type: ToolErrorType.INVALID_ARGUMENT,
      },
    };
  }

  private getTimeoutMs(): number {
    return Math.min(
      (this.params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000,
      MAX_TIMEOUT,
    );
  }

  private createAbortResult(): ToolResult {
    return {
      llmContent: 'Request was aborted before it could start',
      returnDisplay: 'Request aborted',
      error: {
        message: 'Request was aborted before it could start',
        type: ToolErrorType.FETCH_ERROR,
      },
    };
  }

  private async fetchResponse(
    overallSignal: AbortSignal,
  ): Promise<FetchedResponse> {
    return retryWithBackoff(
      async () => {
        const attemptController = new AbortController();
        const onOverallAbort = (): void => attemptController.abort();
        overallSignal.addEventListener('abort', onOverallAbort, { once: true });

        try {
          if (overallSignal.aborted) attemptController.abort();

          const resp = await fetch(this.params.url, {
            signal: attemptController.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: ACCEPT_HEADERS[this.params.format],
              'Accept-Language': 'en-US,en;q=0.9',
            },
          });

          const cancelRequest = (): void => attemptController.abort();

          if (!resp.ok) {
            disposeHttpResponseBody(resp, cancelRequest);
            const error: Error & { status?: number } = new Error(
              `Request failed with status code: ${resp.status}`,
            );
            // A 4xx is terminal here: the request URL and headers are in user
            // control, so a client status is fixed by the caller, not by re-issuing
            // the request. The shared retry helper would otherwise retry its
            // previously-retryable 401/403/429 statuses, so each 4xx error is
            // re-thrown locally as a plain Error without the status property.
            if (isTerminal4xx(resp.status)) {
              throw error;
            }
            error.status = resp.status;
            throw error;
          }

          return { response: resp, cancelRequest };
        } finally {
          overallSignal.removeEventListener('abort', onOverallAbort);
        }
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        signal: overallSignal,
      },
    );
  }

  private async readBoundedResponse(
    response: Response,
    signal: AbortSignal,
    cancelRequest: () => void,
  ): Promise<string> {
    const body = await acquireBoundedHttpBody(
      response,
      FETCH_BYTE_BUDGET,
      signal,
      cancelRequest,
    );
    return body.text;
  }

  private convertContent(content: string, contentType: string): string {
    if (
      this.params.format === 'markdown' &&
      contentType.includes('text/html')
    ) {
      return this.convertHTMLToMarkdown(content);
    }
    if (this.params.format === 'text' && contentType.includes('text/html')) {
      return this.extractTextFromHTML(content);
    }
    return content;
  }

  private createFetchErrorResult(error: unknown): ToolResult {
    const errorMessage = this.formatErrorMessage(error);
    return {
      llmContent: `Error fetching URL: ${errorMessage}`,
      returnDisplay: `Error: ${errorMessage}`,
      error: {
        message: errorMessage,
        type: ToolErrorType.FETCH_ERROR,
      },
    };
  }

  private formatErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) return String(error);

    let errorMessage = error.message;
    if (this.isTruthyCause(error.cause)) {
      const causeMessage =
        error.cause instanceof Error
          ? error.cause.message
          : String(error.cause);
      errorMessage += `: ${causeMessage}`;
    }
    return errorMessage;
  }

  private isTruthyCause(cause: unknown): boolean {
    if (cause === undefined || cause === null) return false;
    if (cause === false || cause === 0 || cause === '') return false;
    return !Number.isNaN(cause);
  }

  private extractTextFromHTML(html: string): string {
    return htmlToText(html).trim();
  }

  private convertHTMLToMarkdown(html: string): string {
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });
    turndownService.remove(['script', 'style', 'meta', 'link']);
    return turndownService.turndown(html);
  }
}
