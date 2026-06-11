/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IWebSearchService } from '../interfaces/index.js';
import { BaseDeclarativeTool, Kind, type ToolInvocation } from './tools.js';
import {
  GoogleWebSearchToolInvocation,
  type WebSearchToolParams,
  type WebSearchToolResult,
} from './google-web-search-invocation.js';

export type {
  WebSearchToolParams,
  WebSearchToolResult,
} from './google-web-search-invocation.js';

export class GoogleWebSearchTool extends BaseDeclarativeTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name: string = 'google_web_search';

  constructor(private readonly webSearchService: IWebSearchService) {
    super(
      GoogleWebSearchTool.Name,
      'GoogleSearch',
      'Performs a web search using Google Search (via the Gemini API) and returns the results. This tool is useful for finding information on the internet based on a query.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find information on the web.',
          },
        },
        required: ['query'],
      },
      false,
    );
  }

  protected override validateToolParamValues(
    params: WebSearchToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: WebSearchToolParams,
    messageBus?: import('../interfaces/index.js').IToolMessageBus,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new GoogleWebSearchToolInvocation(
      this.webSearchService,
      params,
      messageBus,
    );
  }
}
