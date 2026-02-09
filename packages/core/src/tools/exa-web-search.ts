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
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { Config } from '../config/config.js';
import { BaseToolInvocation } from './tools.js';
import fetch from 'node-fetch';

const API_CONFIG = {
  BASE_URL: 'https://mcp.exa.ai',
  ENDPOINTS: {
    SEARCH: '/mcp',
  },
  DEFAULT_NUM_RESULTS: 8,
} as const;

interface McpSearchRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      numResults?: number;
      livecrawl?: 'fallback' | 'preferred';
      type?: 'auto' | 'fast' | 'deep';
      contextMaxCharacters?: number;
    };
  };
}

interface McpSearchResponse {
  jsonrpc: string;
  result: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
}

export interface ExaWebSearchToolParams {
  query: string;
  numResults?: number;
  livecrawl?: 'fallback' | 'preferred';
  type?: 'auto' | 'fast' | 'deep';
  contextMaxCharacters?: number;
}

export class ExaWebSearchTool extends BaseDeclarativeTool<
  ExaWebSearchToolParams,
  ToolResult
> {
  static readonly Name = 'exa_web_search';

  constructor(private readonly config: Config) {
    super(
      ExaWebSearchTool.Name,
      'ExaWebSearch',
      'Search the web using Exa AI - performs real-time web searches and can scrape content from specific URLs. Provides up-to-date information for current events and recent data.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Websearch query',
          },
          numResults: {
            type: 'number',
            description: 'Number of search results to return (default: 8)',
          },
          livecrawl: {
            type: 'string',
            enum: ['fallback', 'preferred'],
            description:
              "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
          },
          type: {
            type: 'string',
            enum: ['auto', 'fast', 'deep'],
            description:
              "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
          },
          contextMaxCharacters: {
            type: 'number',
            description:
              'Maximum characters for context string optimized for LLMs (default: 10000)',
          },
        },
        required: ['query'],
      },
    );
  }

  protected createInvocation(
    params: ExaWebSearchToolParams,
  ): ToolInvocation<ExaWebSearchToolParams, ToolResult> {
    return new ExaWebSearchToolInvocation(this.config, params);
  }
}

class ExaWebSearchToolInvocation extends BaseToolInvocation<
  ExaWebSearchToolParams,
  ToolResult
> {
  constructor(_config: Config, params: ExaWebSearchToolParams) {
    super(params);
  }

  getDescription(): string {
    return `Search web for: ${this.params.query}`;
  }

  /**
   * @plan PLAN-20260206-TOOLKEY.P11
   * @requirement REQ-004.1, REQ-004.3, REQ-004.4
   * @pseudocode lines 384-392
   */
  private async buildEndpointUrl(): Promise<string> {
    const baseUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`;
    const { getToolKeyStorage } = await import('./tool-key-storage.js');
    const storage = getToolKeyStorage();
    const key = await storage.resolveKey('exa');
    if (key !== null) {
      return `${baseUrl}?exaApiKey=${encodeURIComponent(key)}`;
    }
    return baseUrl;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const searchRequest: McpSearchRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query: this.params.query,
          type: this.params.type || 'auto',
          numResults: this.params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
          livecrawl: this.params.livecrawl || 'fallback',
          contextMaxCharacters: this.params.contextMaxCharacters ?? 10000,
        },
      },
    };

    try {
      const headers: Record<string, string> = {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      };

      // @plan PLAN-20260206-TOOLKEY.P11 @pseudocode lines 394-396
      const endpointUrl = await this.buildEndpointUrl();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(searchRequest),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Search error (${response.status}): ${errorText}`);
      }

      const responseText = await response.text();

      // Parse SSE response
      const lines = responseText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data: McpSearchResponse = JSON.parse(line.substring(6));
            if (
              data.result &&
              data.result.content &&
              data.result.content.length > 0
            ) {
              const content = data.result.content[0].text;
              return {
                llmContent: content,
                returnDisplay: content,
              };
            }
          } catch (_e) {
            // Ignore parse errors
          }
        }
      }

      return {
        llmContent: 'No search results found. Please try a different query.',
        returnDisplay: 'No results found.',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error performing web search: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }
}
