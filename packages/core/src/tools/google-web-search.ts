/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, Kind, type ToolInvocation } from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { Config } from '../config/config.js';
import {
  GoogleWebSearchToolInvocation,
  type WebSearchToolParams,
  type WebSearchToolResult,
} from './google-web-search-invocation.js';

// Re-export interfaces for external consumers
export type {
  WebSearchToolParams,
  WebSearchToolResult,
} from './google-web-search-invocation.js';

/**
 * A tool to perform web searches using Google Search via the Gemini API.
 */
export class GoogleWebSearchTool extends BaseDeclarativeTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name: string = 'google_web_search';

  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
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
      false, // output is not markdown
      false, // output cannot be updated
      messageBus,
    );
  }

  /**
   * Validates the parameters for the GoogleWebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
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
    messageBus?: MessageBus,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new GoogleWebSearchToolInvocation(this.config, params, messageBus);
  }
}
