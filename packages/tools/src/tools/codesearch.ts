/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portions of this code are derived from opencode (https://github.com/sst/opencode)
 * Copyright (c) 2025 opencode
 * Licensed under the MIT License.
 */

import type {
  ISettingsService,
  IToolKeyStorage,
  IToolMessageBus,
} from '../interfaces/index.js';
import { ToolErrorType } from '../types/tool-error.js';
import { ensureJsonSafe } from '../utils/unicodeUtils.js';
import { createDefaultByteBudget } from '../acquisition/index.js';
import {
  acquireBoundedHttpBody,
  HttpBodyTooLargeError,
} from '../acquisition/bounded-http-response.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
  type LiveOutputUpdate,
} from './tools.js';

const API_CONFIG = {
  BASE_URL: 'https://mcp.exa.ai',
  ENDPOINTS: {
    CONTEXT: '/mcp',
  },
} as const;

const SEARCH_BYTE_BUDGET = createDefaultByteBudget();

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
    content?: Array<{
      type: string;
      text: string;
    }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface CodeSearchToolParams {
  query: string;
  tokensNum?: number;
}

/**
 * Discriminated result of parsing a single SSE data line from the Exa MCP.
 * - ok:true carries the content to return to the model.
 * - ok:false carries an upstream failure message that must surface as an error.
 */
type ParsedCodeLine =
  | { ok: true; content: string }
  | { ok: false; errorText: string };

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
    messageBus?: IToolMessageBus,
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
    messageBus?: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return `Search code for: ${this.params.query}`;
  }

  private async buildEndpointUrl(): Promise<string> {
    const baseUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`;
    const params = new URLSearchParams();
    params.set('tools', 'get_code_context_exa');
    const key = await this.dependencies.keyStorage?.resolveKey('exa');
    if (key !== undefined && key !== null) {
      params.set('exaApiKey', key);
    }
    return `${baseUrl}?${params.toString()}`;
  }

  private async readResponseBody(
    response: Response,
    signal: AbortSignal,
    cancelRequest: () => void,
  ): Promise<string> {
    const body = await acquireBoundedHttpBody(
      response,
      SEARCH_BYTE_BUDGET,
      signal,
      cancelRequest,
    );
    return body.text;
  }

  /**
   * Read a non-success response body. When the body exceeds the byte budget,
   * the HTTP status is preserved in the thrown error message.
   */
  private async readErrorResponseBody(
    response: Response,
    signal: AbortSignal,
    cancelRequest: () => void,
  ): Promise<string> {
    try {
      return await this.readResponseBody(response, signal, cancelRequest);
    } catch (error) {
      if (error instanceof HttpBodyTooLargeError) {
        throw new Error(
          `Code search error (${response.status}): ${error.message}`,
        );
      }
      throw error;
    }
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
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

    const localController = new AbortController();
    const onSignalAbort = (): void => localController.abort();
    signal.addEventListener('abort', onSignalAbort, { once: true });

    try {
      if (signal.aborted) localController.abort();

      const headers: Record<string, string> = {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      };

      const endpointUrl = await this.buildEndpointUrl();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(codeRequest),
        signal: localController.signal,
      });

      const cancelRequest = (): void => localController.abort();

      if (!response.ok) {
        const errorText = await this.readErrorResponseBody(
          response,
          signal,
          cancelRequest,
        );
        throw new Error(`Code search error (${response.status}): ${errorText}`);
      }

      const responseText = await this.readResponseBody(
        response,
        signal,
        cancelRequest,
      );
      return this.parseResponseResult(responseText);
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
    } finally {
      signal.removeEventListener('abort', onSignalAbort);
    }
  }

  private parseResponseResult(responseText: string): ToolResult {
    const lines = responseText.split('\n');
    for (const line of lines) {
      const parsed = this.parseCodeResponseLine(line);
      if (parsed === undefined) {
        continue;
      }
      if (!parsed.ok) {
        const safeErrorText = ensureJsonSafe(parsed.errorText);
        return {
          llmContent: `Code search failed: ${safeErrorText}`,
          returnDisplay: `Code search failed: ${safeErrorText}`,
          error: {
            message: safeErrorText,
            type: ToolErrorType.SEARCH_ERROR,
          },
        };
      }
      return {
        llmContent: parsed.content,
        returnDisplay: parsed.content,
      };
    }
    return {
      llmContent:
        'No code snippets or documentation found. Please try a different query.',
      returnDisplay: 'No results found.',
    };
  }

  private parseCodeResponseLine(line: string): ParsedCodeLine | undefined {
    if (!line.startsWith('data: ')) {
      return undefined;
    }
    let data: McpCodeResponse;
    try {
      data = JSON.parse(line.substring(6));
    } catch {
      // A malformed intermediate SSE line is genuinely unpredictable
      // external input; skip it without aborting the whole stream.
      return undefined;
    }

    if (data.error) {
      const code =
        typeof data.error.code === 'number'
          ? String(data.error.code)
          : 'unknown';
      const message =
        typeof data.error.message === 'string' && data.error.message.length > 0
          ? data.error.message
          : 'no message provided by upstream server';
      return {
        ok: false,
        errorText: `MCP error ${code}: ${message}`,
      };
    }
    if (data.result?.isError === true) {
      const text = data.result.content?.[0]?.text;
      return {
        ok: false,
        errorText:
          text ?? 'the upstream server reported an error with no message.',
      };
    }
    const content = data.result?.content;
    if (content !== undefined && content.length > 0) {
      return { ok: true, content: ensureJsonSafe(content[0].text) };
    }
    return undefined;
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
