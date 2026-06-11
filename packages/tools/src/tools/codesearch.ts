/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portions of this code are derived from opencode (https://github.com/sst/opencode)
 * Copyright (c) 2025 opencode
 * Licensed under the MIT License.
 */

import fetch from 'node-fetch';

import type { ISettingsService, IToolKeyStorage } from '../interfaces/index.js';
import { ToolErrorType } from '../types/tool-error.js';
import { ensureJsonSafe } from '../utils/unicodeUtils.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';

const API_CONFIG = {
  BASE_URL: 'https://mcp.exa.ai',
  ENDPOINTS: {
    CONTEXT: '/mcp',
  },
} as const;

const TOKEN_LIMITS = {
  DEFAULT: 5000,
  MIN: 1000,
  MAX: 50000,
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
  result?: {
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

export interface CodeSearchToolDependencies {
  keyStorage?: Pick<IToolKeyStorage, 'resolveKey'>;
  settingsService?: Pick<ISettingsService, 'getSetting' | 'getSettingsService'>;
}

export class CodeSearchTool extends BaseDeclarativeTool<
  CodeSearchToolParams,
  ToolResult
> {
  static readonly Name = 'codesearch';

  constructor(private readonly dependencies: CodeSearchToolDependencies = {}) {
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
            default: TOKEN_LIMITS.DEFAULT,
            minimum: TOKEN_LIMITS.MIN,
            maximum: TOKEN_LIMITS.MAX,
          },
        },
        required: ['query'],
      },
    );
  }

  protected createInvocation(
    params: CodeSearchToolParams,
    messageBus?: import('../interfaces/index.js').IToolMessageBus,
  ): ToolInvocation<CodeSearchToolParams, ToolResult> {
    return new CodeSearchToolInvocation(this.dependencies, params, messageBus);
  }
}

class CodeSearchToolInvocation extends BaseToolInvocation<
  CodeSearchToolParams,
  ToolResult
> {
  constructor(
    private readonly dependencies: CodeSearchToolDependencies,
    params: CodeSearchToolParams,
    messageBus?: import('../interfaces/index.js').IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return `Search code for: ${this.params.query}`;
  }

  private async buildEndpointUrl(): Promise<string> {
    const baseUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`;
    const key = await this.dependencies.keyStorage?.resolveKey('exa');
    if (key !== undefined && key !== null) {
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
      const lines = responseText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data: McpCodeResponse = JSON.parse(line.substring(6));
            if (
              data.result?.content !== undefined &&
              data.result.content.length > 0
            ) {
              const content = ensureJsonSafe(data.result.content[0].text);
              return {
                llmContent: content,
                returnDisplay: content,
              };
            }
          } catch {
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
    const settingMaxTokens = this.getSettingMaxTokens();
    let tokens = this.params.tokensNum ?? TOKEN_LIMITS.DEFAULT;

    if (settingMaxTokens !== undefined) {
      tokens = Math.min(tokens, settingMaxTokens);
    }

    return Math.max(TOKEN_LIMITS.MIN, Math.min(tokens, TOKEN_LIMITS.MAX));
  }

  private getSettingMaxTokens(): number | undefined {
    const directValue = this.dependencies.settingsService?.getSetting(
      'tool-output-max-tokens',
    );
    if (typeof directValue === 'number') return directValue;

    const nestedValue = this.dependencies.settingsService
      ?.getSettingsService()
      .get?.('tool-output-max-tokens');
    return typeof nestedValue === 'number' ? nestedValue : undefined;
  }
}
