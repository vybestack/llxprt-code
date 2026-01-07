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
import { Config } from '../config/config.js';
import { BaseToolInvocation } from './tools.js';
import { DIRECT_WEB_FETCH_TOOL } from './tool-names.js';
import fetch, { type RequestInit } from 'node-fetch';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

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
  ): ToolInvocation<DirectWebFetchToolParams, ToolResult> {
    return new DirectWebFetchToolInvocation(this.config, params);
  }
}

class DirectWebFetchToolInvocation extends BaseToolInvocation<
  DirectWebFetchToolParams,
  ToolResult
> {
  constructor(
    _config: Config,
    params: DirectWebFetchToolParams,
    messageBus?: MessageBus,
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
    const { url, format, timeout: timeoutSec } = this.params;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return {
        llmContent: 'URL must start with http:// or https://',
        returnDisplay: 'Invalid URL',
        error: {
          message: 'Invalid URL protocol',
          type: ToolErrorType.INVALID_ARGUMENT,
        },
      };
    }

    const timeout = Math.min(
      (timeoutSec ?? DEFAULT_TIMEOUT / 1000) * 1000,
      MAX_TIMEOUT,
    );

    // Build Accept header
    let acceptHeader = '*/*';
    switch (format) {
      case 'markdown':
        acceptHeader =
          'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';
        break;
      case 'text':
        acceptHeader =
          'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1';
        break;
      case 'html':
        acceptHeader =
          'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1';
        break;
      default:
        acceptHeader =
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // If the parent signal aborts, we should also abort our controller
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: acceptHeader,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      } as RequestInit);

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large (exceeds 5MB limit)');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large (exceeds 5MB limit)');
      }

      const content = new TextDecoder().decode(arrayBuffer);
      const contentType = response.headers.get('content-type') || '';

      let output = content;

      switch (format) {
        case 'markdown':
          if (contentType.includes('text/html')) {
            output = this.convertHTMLToMarkdown(content);
          }
          break;

        case 'text':
          if (contentType.includes('text/html')) {
            output = this.extractTextFromHTML(content);
          }
          break;
        default:
          break;
      }

      return {
        llmContent: output,
        returnDisplay: `Fetched ${url} as ${format}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error fetching URL: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.FETCH_ERROR,
        },
      };
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    }
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
