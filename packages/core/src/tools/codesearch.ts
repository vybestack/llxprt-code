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
    CONTEXT: '/mcp',
  },
} as const;

interface McpCodeRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      tokensNum: number;
    };
  };
}

interface McpCodeResponse {
  jsonrpc: string;
  result: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
}

export interface CodeSearchToolParams {
  query: string;
  tokensNum?: number;
}

export class CodeSearchTool extends BaseDeclarativeTool<
  CodeSearchToolParams,
  ToolResult
> {
  static readonly Name = 'codesearch';

  constructor(private readonly config: Config) {
    super(
      CodeSearchTool.Name,
      'CodeSearch',
      'Search for relevant code snippets, APIs, Libraries, and SDKs documentation. Use this to find examples and usage patterns.',
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "Search query to find relevant context. For example, 'React useState hook examples', 'Python pandas dataframe filtering'.",
          },
          tokensNum: {
            type: 'number',
            description:
              'Number of tokens to return (1000-50000). Default is 5000 tokens.',
            default: 5000,
            minimum: 1000,
            maximum: 50000,
          },
        },
        required: ['query'],
      },
    );
  }

  protected createInvocation(
    params: CodeSearchToolParams,
  ): ToolInvocation<CodeSearchToolParams, ToolResult> {
    return new CodeSearchToolInvocation(this.config, params);
  }
}

class CodeSearchToolInvocation extends BaseToolInvocation<
  CodeSearchToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: CodeSearchToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Search code for: ${this.params.query}`;
  }

  /**
   * @plan PLAN-20260206-TOOLKEY.P11
   * @requirement REQ-004.1, REQ-004.2, REQ-004.3
   * @pseudocode lines 399-407
   */
  private async buildEndpointUrl(): Promise<string> {
    const baseUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`;
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
    const codeRequest: McpCodeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_code_context_exa',
        arguments: {
          query: this.params.query,
          tokensNum: this.getEffectiveTokensNum(),
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
        body: JSON.stringify(codeRequest),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Code search error (${response.status}): ${errorText}`);
      }

      const responseText = await response.text();

      // Parse SSE response
      // The response from mcp.exa.ai seems to be SSE format "data: {...}"
      const lines = responseText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data: McpCodeResponse = JSON.parse(line.substring(6));
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
            // Ignore parse errors for intermediate lines
          }
        }
      }

      return {
        llmContent:
          'No code snippets or documentation found. Please try a different query.',
        returnDisplay: 'No results found.',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error performing code search: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.SEARCH_ERROR,
        },
      };
    }
  }

  private getEffectiveTokensNum(): number {
    // Limits from: https://github.com/exa-labs/exa-mcp-server/blob/1ec2078b59d5e4503696fecf9ce40701ccef85cc/src/tools/exaCode.ts#L14
    const LIMITS = {
      DEFAULT: 5000,
      MIN: 1000,
      MAX: 50000,
    };

    const settingMaxTokens = this.config
      .getSettingsService()
      .get('tool-output-max-tokens') as number | undefined;

    // 1. Determine requested tokens (Param > Default)
    let tokens = this.params.tokensNum ?? LIMITS.DEFAULT;

    // 2. Apply setting as a hard cap if present
    if (
      settingMaxTokens !== undefined &&
      typeof settingMaxTokens === 'number'
    ) {
      tokens = Math.min(tokens, settingMaxTokens);
    }

    // 3. Clamp to absolute API limits
    return Math.max(LIMITS.MIN, Math.min(tokens, LIMITS.MAX));
  }
}
