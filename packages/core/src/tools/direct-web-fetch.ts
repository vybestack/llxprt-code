/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portions of this code are derived from opencode (https://github.com/sst/opencode)
 * Copyright (c) 2025 opencode
 * Licensed under the MIT License.
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  BaseDeclarativeTool,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';
import { BaseToolInvocation } from './tools.js';
import { DIRECT_WEB_FETCH_TOOL } from './tool-names.js';
import fetch, { type RequestInit } from 'node-fetch';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import { retryWithBackoff } from '../utils/retry.js';
import { ensureJsonSafe } from '../utils/unicodeUtils.js';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes
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

  constructor(private readonly config: Config) {
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
    messageBus: MessageBus,
  ): ToolInvocation<DirectWebFetchToolParams, ToolResult> {
    return new DirectWebFetchToolInvocation(this.config, params, messageBus);
  }
}

class DirectWebFetchToolInvocation extends BaseToolInvocation<
  DirectWebFetchToolParams,
  ToolResult
> {
  constructor(
    _config: Config,
    params: DirectWebFetchToolParams,
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return `Fetch content from ${this.params.url}`;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const protocolError = this.validateUrlProtocol();
    if (protocolError) return protocolError;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.getTimeoutMs());
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);

    try {
      if (signal.aborted) return this.createAbortResult();

      const response = await this.fetchResponse(controller.signal);
      const arrayBuffer = await this.readBoundedResponse(response);
      const content = new TextDecoder().decode(arrayBuffer);
      const output = this.convertContent(
        content,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Preserve prior empty-string fallback for missing/blank content-type.
        response.headers.get('content-type') || '',
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

  private async fetchResponse(signal: AbortSignal) {
    return retryWithBackoff(
      async () => {
        const resp = await fetch(this.params.url, {
          signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: ACCEPT_HEADERS[this.params.format],
            'Accept-Language': 'en-US,en;q=0.9',
          },
        } as RequestInit);

        if (!resp.ok) {
          const error = new Error(
            `Request failed with status code: ${resp.status}`,
          ) as Error & { status: number };
          error.status = resp.status;
          throw error;
        }

        return resp;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        retryFetchErrors: true,
        signal,
      },
    );
  }

  private async readBoundedResponse(
    response: Awaited<ReturnType<typeof fetch>>,
  ): Promise<ArrayBuffer> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      throw new Error('Response too large (exceeds 5MB limit)');
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error('Response too large (exceeds 5MB limit)');
    }
    return arrayBuffer;
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
    const err = error as Error & { cause?: unknown };
    if (this.hasTruthyCause(err)) {
      const causeMessage =
        err.cause instanceof Error ? err.cause.message : String(err.cause);
      errorMessage += `: ${causeMessage}`;
    }
    return errorMessage;
  }

  private hasTruthyCause(error: Error & { cause?: unknown }): boolean {
    if (!('cause' in error)) return false;
    return this.isTruthyCause(error.cause);
  }

  private isTruthyCause(cause: unknown): boolean {
    if (cause === undefined || cause === null) return false;
    if (cause === false || cause === 0 || cause === '') return false;
    return !Number.isNaN(cause);
  }

  private extractTextFromHTML(html: string): string {
    const $ = cheerio.load(html);
    // Remove scripts, styles, etc.
    $('script, style, noscript, iframe, object, embed').remove();
    return $.text().trim();
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
