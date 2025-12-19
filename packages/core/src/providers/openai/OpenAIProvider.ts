/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */

import OpenAI from 'openai';
import crypto from 'node:crypto';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { type IContent } from '../../services/history/IContent.js';
import type { Config } from '../../config/config.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import { type ToolFormat } from '../../tools/IToolFormatter.js';
import {
  isKimiModel,
  isMistralModel,
  getToolIdStrategy,
  type ToolIdMapper,
} from '../../tools/ToolIdStrategy.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import {
  flushRuntimeAuthScope,
  type OAuthManager,
} from '../../auth/precedence.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { convertToolsToOpenAI, type OpenAITool } from './schemaConverter.js';
import { GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
import {
  type ToolCallBlock,
  type TextBlock,
  type ToolResponseBlock,
  type ThinkingBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { type IModel } from '../IModel.js';
import { type IProvider } from '../IProvider.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { filterOpenAIRequestParams } from './openaiRequestParams.js';
import { ensureJsonSafe } from '../../utils/unicodeUtils.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import { isLocalEndpoint } from '../utils/localEndpoint.js';
import {
  filterThinkingForContext,
  thinkingToReasoningField,
  extractThinkingBlocks,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';
import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';

const TOOL_ARGS_PREVIEW_LENGTH = 500;

export class OpenAIProvider extends BaseProvider implements IProvider {
  private readonly textToolParser = new GemmaToolCallParser();
  private readonly toolCallPipeline = new ToolCallPipeline();
  private readonly toolCallProcessingMode: 'pipeline' | 'legacy';

  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:provider:openai');
  }

  private async handleBucketFailoverOnPersistent429(
    options: NormalizedGenerateChatOptions,
    logger: DebugLogger,
  ): Promise<{ result: boolean | null; client?: OpenAI }> {
    const failoverHandler = options.runtime?.config?.getBucketFailoverHandler();

    if (!failoverHandler || !failoverHandler.isEnabled()) {
      return { result: null };
    }

    logger.debug(() => 'Attempting bucket failover on persistent 429');
    const success = await failoverHandler.tryFailover();
    if (!success) {
      logger.debug(() => 'Bucket failover failed - no more buckets available');
      return { result: false };
    }

    const previousAuthToken = options.resolved.authToken;

    try {
      // Clear runtime-scoped auth cache so subsequent auth resolution can pick up the new bucket.
      if (typeof options.runtime?.runtimeId === 'string') {
        flushRuntimeAuthScope(options.runtime.runtimeId);
      }

      // Force re-resolution of the auth token after bucket failover.
      options.resolved.authToken = '';
      const refreshedAuthToken = await this.getAuthTokenForPrompt();
      options.resolved.authToken = refreshedAuthToken;

      // Rebuild client with fresh credentials from new bucket
      const client = await this.getClient(options);
      logger.debug(
        () =>
          `Bucket failover successful, new bucket: ${failoverHandler.getCurrentBucket()}`,
      );
      return { result: true, client };
    } catch (error) {
      options.resolved.authToken = previousAuthToken;
      logger.debug(
        () =>
          `Bucket failover auth refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { result: false };
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Constructor reduced to minimal initialization - no state captured
   */
  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Normalize empty string to undefined for proper precedence handling
    const normalizedApiKey =
      apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    // Detect if this is a Qwen endpoint
    // CRITICAL FIX: For now, only use base URL check in constructor since `this.name` isn't available yet
    // The name-based check will be handled in the supportsOAuth() method after construction
    let isQwenEndpoint = false;
    if (baseURL) {
      try {
        const hostname = new URL(baseURL).hostname.toLowerCase();
        isQwenEndpoint =
          hostname === 'dashscope.aliyuncs.com' ||
          hostname.endsWith('.dashscope.aliyuncs.com') ||
          hostname === 'api.qwen.com' ||
          hostname.endsWith('.qwen.com');
      } catch {
        const lowered = baseURL.toLowerCase();
        isQwenEndpoint =
          lowered.includes('dashscope.aliyuncs.com') ||
          lowered.includes('api.qwen.com') ||
          lowered.includes('qwen.com');
      }
    }
    const forceQwenOAuth = Boolean(
      (config as { forceQwenOAuth?: boolean } | undefined)?.forceQwenOAuth,
    );

    // Initialize base provider with auth configuration
    super(
      {
        name: 'openai',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'], // Support environment variable fallback
        isOAuthEnabled: (isQwenEndpoint || forceQwenOAuth) && !!oauthManager,
        oauthProvider: isQwenEndpoint || forceQwenOAuth ? 'qwen' : undefined,
        oauthManager,
      },
      config,
    );

    // Initialize tool call processing mode - default to 'legacy' (fallback)
    this.toolCallProcessingMode = config?.toolCallProcessingMode ?? 'legacy';

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002
    // No constructor-captured state - all values sourced from normalized options per call
  }

  /**
   * Create HTTP/HTTPS agents with socket configuration for local AI servers
   * Returns undefined if no socket settings are configured
   *
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Now sources ephemeral settings from call options instead of provider config
   */
  private createHttpAgents(
    options?: NormalizedGenerateChatOptions,
  ): { httpAgent: http.Agent; httpsAgent: https.Agent } | undefined {
    // Get socket configuration from call options or fallback to provider config
    const settingsFromInvocation = options?.invocation?.ephemerals;
    const settings =
      settingsFromInvocation ??
      this.providerConfig?.getEphemeralSettings?.() ??
      {};

    // Check if any socket settings are explicitly configured
    const hasSocketSettings =
      'socket-timeout' in settings ||
      'socket-keepalive' in settings ||
      'socket-nodelay' in settings;

    // Only create custom agents if socket settings are configured
    if (!hasSocketSettings) {
      return undefined;
    }

    // Socket configuration with defaults for when settings ARE configured
    const socketTimeout = (settings['socket-timeout'] as number) || 60000; // 60 seconds default
    const socketKeepAlive = settings['socket-keepalive'] !== false; // true by default
    const socketNoDelay = settings['socket-nodelay'] !== false; // true by default

    // Create HTTP agent with socket options
    const httpAgent = new http.Agent({
      keepAlive: socketKeepAlive,
      keepAliveMsecs: 1000,
      timeout: socketTimeout,
    });

    // Create HTTPS agent with socket options
    const httpsAgent = new https.Agent({
      keepAlive: socketKeepAlive,
      keepAliveMsecs: 1000,
      timeout: socketTimeout,
    });

    // Apply TCP_NODELAY if enabled (reduces latency for local servers)
    if (socketNoDelay) {
      const originalCreateConnection = httpAgent.createConnection;
      httpAgent.createConnection = function (options, callback) {
        const socket = originalCreateConnection.call(this, options, callback);
        if (socket instanceof net.Socket) {
          socket.setNoDelay(true);
        }
        return socket;
      };

      const originalHttpsCreateConnection = httpsAgent.createConnection;
      httpsAgent.createConnection = function (options, callback) {
        const socket = originalHttpsCreateConnection.call(
          this,
          options,
          callback,
        );
        if (socket instanceof net.Socket) {
          socket.setNoDelay(true);
        }
        return socket;
      };
    }

    return { httpAgent, httpsAgent };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Extract model parameters from normalized options instead of settings service
   */
  private extractModelParamsFromOptions(
    options: NormalizedGenerateChatOptions,
  ): Record<string, unknown> | undefined {
    const providerSettings =
      options.settings?.getProviderSettings(this.name) ?? {};
    const configEphemerals = options.invocation?.ephemerals ?? {};

    const filteredProviderParams = filterOpenAIRequestParams(providerSettings);
    const filteredEphemeralParams = filterOpenAIRequestParams(configEphemerals);

    if (!filteredProviderParams && !filteredEphemeralParams) {
      return undefined;
    }

    return {
      ...(filteredProviderParams ?? {}),
      ...(filteredEphemeralParams ?? {}),
    };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Resolve runtime key from normalized options for client scoping
   */
  private resolveRuntimeKey(options: NormalizedGenerateChatOptions): string {
    if (options.runtime?.runtimeId) {
      return options.runtime.runtimeId;
    }

    const metadataRuntimeId = options.metadata?.runtimeId;
    if (typeof metadataRuntimeId === 'string' && metadataRuntimeId.trim()) {
      return metadataRuntimeId.trim();
    }

    const callId = options.settings.get('call-id');
    if (typeof callId === 'string' && callId.trim()) {
      return `call:${callId.trim()}`;
    }

    return 'openai.runtime.unscoped';
  }

  /**
   * Tool formatter instances cannot be shared between stateless calls,
   * so construct a fresh one for every invocation.
   *
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   */
  private createToolFormatter(): ToolFormatter {
    return new ToolFormatter();
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * Instantiates a fresh OpenAI client per call to preserve stateless behaviour.
   */
  private instantiateClient(
    authToken: string,
    baseURL?: string,
    agents?: { httpAgent: http.Agent; httpsAgent: https.Agent },
    headers?: Record<string, string>,
  ): OpenAI {
    const clientOptions: Record<string, unknown> = {
      apiKey: authToken || '',
      maxRetries: 0,
    };

    if (headers && Object.keys(headers).length > 0) {
      // Ensure headers like User-Agent are applied even if the SDK call-site
      // headers option is not forwarded by the OpenAI client implementation.
      clientOptions.defaultHeaders = headers;
    }

    if (baseURL && baseURL.trim() !== '') {
      clientOptions.baseURL = baseURL;
    }

    if (agents) {
      clientOptions.httpAgent = agents.httpAgent;
      clientOptions.httpsAgent = agents.httpsAgent;
    }

    return new OpenAI(
      clientOptions as unknown as ConstructorParameters<typeof OpenAI>[0],
    );
  }

  /**
   * Coerce provider "content" (which may be a string or an array-of-parts)
   * into a plain string. Defensive for OpenAI-compatible providers that emit
   * structured content blocks.
   */
  private coerceMessageContentToString(content: unknown): string | undefined {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (!part) continue;
        if (typeof part === 'string') {
          parts.push(part);
        } else if (
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          parts.push((part as { text: string }).text);
        }
      }
      return parts.length ? parts.join('') : undefined;
    }
    return undefined;
  }

  /**
   * Strip provider-specific "thinking" / reasoning markup from visible text.
   * This prevents DeepSeek / Kimi-style <think> blocks from leaking into
   * user-visible output or tool arguments.
   */
  private sanitizeProviderText(text: unknown): string {
    if (text === null || text === undefined) {
      return '';
    }

    const logger = this.getLogger();
    let str = typeof text === 'string' ? text : String(text);
    const beforeLen = str.length;
    const hadReasoningTags =
      /<(?:think|thinking|analysis)>|<\/(?:think|thinking|analysis)>/i.test(
        str,
      );

    // DeepSeek / generic <think>...</think> blocks.
    // Replace with a single space to preserve word spacing when tags appear mid-sentence.
    // This prevents "these<think>...</think>5" from becoming "these5" instead of "these 5".
    // Multiple consecutive spaces will be collapsed below.
    str = str.replace(/<think>[\s\S]*?<\/think>/gi, ' ');

    // Alternative reasoning tags some providers use.
    str = str.replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ');
    str = str.replace(/<analysis>[\s\S]*?<\/analysis>/gi, ' ');

    // Clean up stray unmatched tags - replace with space to preserve word separation.
    str = str.replace(/<\/?(?:think|thinking|analysis)>/gi, ' ');

    // Only clean up whitespace if we had reasoning tags to strip
    // This preserves meaningful whitespace in regular text chunks during streaming
    // (e.g., " 5 Biggest" should remain " 5 Biggest", not become "5 Biggest")
    if (hadReasoningTags) {
      // Collapse multiple spaces/tabs but preserve newlines for proper paragraph/line breaks
      str = str.replace(/[ \t]+/g, ' ');
      str = str.replace(/\n{3,}/g, '\n\n');

      // Only trim leading horizontal whitespace (spaces/tabs), NOT newlines
      // This preserves line breaks between think tags and content (fixes #721)
      str = str.replace(/^[ \t]+/, '');
    }

    const afterLen = str.length;
    if (hadReasoningTags && afterLen !== beforeLen) {
      logger.debug(() => `[OpenAIProvider] Stripped reasoning tags`, {
        beforeLen,
        afterLen,
      });
    }

    return str;
  }

  /**
   * Extract thinking content from <think>, <thinking>, or <analysis> tags
   * and return it as a ThinkingBlock. Returns null if no thinking tags found.
   *
   * This must be called BEFORE sanitizeProviderText which strips these tags.
   *
   * Handles two formats:
   * 1. Standard: <think>Full thinking paragraph here...</think>
   * 2. Fragmented (Synthetic API): <think>word</think><think>word</think>...
   *
   * For fragmented format, joins with spaces. For standard, joins with newlines.
   *
   * @plan PLAN-20251202-THINKING.P16
   * @requirement REQ-THINK-003
   */
  private extractThinkTagsAsBlock(text: string): ThinkingBlock | null {
    if (!text) {
      return null;
    }

    // Collect all thinking content from various tag formats
    // Note: We only trim leading/trailing whitespace from each part, not internal newlines
    // This preserves formatting like numbered lists within thinking content
    const thinkingParts: string[] = [];

    // Match <think>...</think>
    const thinkMatches = text.matchAll(/<think>([\s\S]*?)<\/think>/gi);
    for (const match of thinkMatches) {
      const content = match[1];
      if (content?.trim()) {
        // Preserve internal newlines but remove leading/trailing whitespace
        thinkingParts.push(content.trim());
      }
    }

    // Match <thinking>...</thinking>
    const thinkingMatches = text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/gi);
    for (const match of thinkingMatches) {
      const content = match[1];
      if (content?.trim()) {
        thinkingParts.push(content.trim());
      }
    }

    // Match <analysis>...</analysis>
    const analysisMatches = text.matchAll(/<analysis>([\s\S]*?)<\/analysis>/gi);
    for (const match of analysisMatches) {
      const content = match[1];
      if (content?.trim()) {
        thinkingParts.push(content.trim());
      }
    }

    if (thinkingParts.length === 0) {
      return null;
    }

    // Detect fragmented format: many short parts (likely token-by-token streaming)
    // If average part length is very short (< 10 chars) and we have many parts,
    // it's likely fragmented and should be joined with spaces
    const avgPartLength =
      thinkingParts.reduce((sum, p) => sum + p.length, 0) /
      thinkingParts.length;
    const isFragmented = thinkingParts.length > 5 && avgPartLength < 15;

    // Join with space for fragmented, newlines for standard multi-paragraph thinking
    const combinedThought = isFragmented
      ? thinkingParts.join(' ')
      : thinkingParts.join('\n\n');

    this.getLogger().debug(
      () =>
        `[OpenAIProvider] Extracted thinking from tags: ${combinedThought.length} chars`,
      { tagCount: thinkingParts.length, isFragmented, avgPartLength },
    );

    return {
      type: 'thinking',
      thought: combinedThought,
      sourceField: 'think_tags',
      isHidden: false,
    };
  }

  /**
   * Normalize tool name by stripping Kimi-K2 style prefixes.
   *
   * Handles malformed tool names where the model concatenates prefixes like
   * "functions" or "call_functions" with the actual tool name:
   * - "functionslist_directory" -> "list_directory"
   * - "call_functionslist_directory6" -> "list_directory"
   * - "call_functionsglob7" -> "glob"
   */
  private normalizeToolName(name: string): string {
    let normalized = (name || '').trim();

    // Strip Kimi-K2 style prefixes where model concatenates "functions" or "call_functions"
    // with the actual tool name (e.g., "functionslist_directory" -> "list_directory")
    // Pattern: (call_)?functions<actual_tool_name><optional_number>
    const kimiPrefixMatch = /^(?:call_)?functions([a-z_]+[a-z])(\d*)$/i.exec(
      normalized,
    );
    if (kimiPrefixMatch) {
      const originalName = normalized;
      normalized = kimiPrefixMatch[1];
      this.getLogger().debug(
        () =>
          `[OpenAIProvider] Stripped Kimi-style prefix from tool name: "${originalName}" -> "${normalized}"`,
      );
    }

    return normalized.toLowerCase();
  }

  /**
   * Sanitize raw tool argument payloads before JSON parsing:
   * - Remove thinking blocks (<think>...</think>, etc.).
   * - Strip Markdown code fences (```json ... ```).
   * - Try to isolate the main JSON object if wrapped in prose.
   */
  private sanitizeToolArgumentsString(raw: unknown): string {
    if (raw === null || raw === undefined) {
      return '{}';
    }

    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else {
      try {
        text = JSON.stringify(raw);
      } catch {
        text = String(raw);
      }
    }

    text = text.trim();

    // Strip fenced code blocks like ```json { ... } ```.
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-zA-Z0-9_-]*\s*/m, '');
      text = text.replace(/```$/m, '');
      text = text.trim();
    }

    // Remove provider reasoning / thinking markup.
    text = this.sanitizeProviderText(text);

    // If provider wrapped JSON in explanation text, try to isolate the object.
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1).trim();
      if (candidate.startsWith('{') && candidate.endsWith('}')) {
        return candidate;
      }
    }

    return text.length ? text : '{}';
  }

  /**
   * Parse Kimi-K2 `<|tool_calls_section_begin|> ... <|tool_calls_section_end|>`
   * blocks out of a text string.
   *
   * - Returns cleanedText with the whole section removed.
   * - Returns ToolCallBlock[] constructed from the section contents.
   *
   * This is used for HF/vLLM-style Kimi deployments where `tool_calls` is empty
   * and all tool info is only encoded in the text template.
   */
  private extractKimiToolCallsFromText(raw: string): {
    cleanedText: string;
    toolCalls: ToolCallBlock[];
  } {
    // Return early only if input is null/undefined/empty
    if (!raw) {
      return { cleanedText: raw, toolCalls: [] };
    }

    const logger = this.getLogger();
    const toolCalls: ToolCallBlock[] = [];
    let text = raw;

    // Extract tool calls from complete sections if present
    if (raw.includes('<|tool_calls_section_begin|>')) {
      const sectionRegex =
        /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g;

      text = text.replace(
        sectionRegex,
        (_sectionMatch: string, sectionBody: string) => {
          try {
            const callRegex =
              /<\|tool_call_begin\|>\s*([^<]+?)\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;

            let m: RegExpExecArray | null;
            while ((m = callRegex.exec(sectionBody)) !== null) {
              const rawId = m[1].trim();
              const rawArgs = m[2].trim();

              // Infer tool name from ID.
              let toolName = '';
              const match =
                /^functions\.([A-Za-z0-9_]+):\d+/i.exec(rawId) ||
                /^[A-Za-z0-9_]+\.([A-Za-z0-9_]+):\d+/.exec(rawId);
              if (match) {
                toolName = match[1];
              } else {
                const colonParts = rawId.split(':');
                const head = colonParts[0] || rawId;
                const dotParts = head.split('.');
                toolName = dotParts[dotParts.length - 1] || head;
              }

              // Normalize tool name (handles Kimi-K2 style prefixes like call_functionsglob7)
              toolName = this.normalizeToolName(toolName);

              const sanitizedArgs = this.sanitizeToolArgumentsString(rawArgs);
              const processedParameters = processToolParameters(
                sanitizedArgs,
                toolName,
              );

              toolCalls.push({
                type: 'tool_call',
                id: this.normalizeToHistoryToolId(rawId),
                name: toolName,
                parameters: processedParameters,
              } as ToolCallBlock);
            }
          } catch (err) {
            logger.debug(
              () =>
                `[OpenAIProvider] Failed to parse Kimi tool_calls_section: ${err}`,
            );
          }

          // Strip the entire tool section from user-visible text
          return '';
        },
      );

      if (toolCalls.length > 0) {
        logger.debug(() => `[OpenAIProvider] Parsed Kimi tool_calls_section`, {
          toolCallCount: toolCalls.length,
          originalLength: raw.length,
          cleanedLength: text.length,
        });
      }
    }

    // ALWAYS run stray token cleanup, even if no complete sections were found
    // This handles partial sections, malformed tokens, orphaned markers, etc.
    text = text.replace(
      /<\|tool_call(?:_(?:begin|end|argument_begin))?\|>/g,
      '',
    );
    text = text.replace(/<\|tool_calls_section_(?:begin|end)\|>/g, '');

    // Don't trim - preserve leading/trailing newlines that are important for formatting
    // (e.g., numbered lists from Kimi K2 that have newlines between items)
    return { cleanedText: text, toolCalls };
  }

  /**
   * Clean Kimi K2 tool call tokens from thinking content.
   * Used when extracting thinking from <think> tags that may contain embedded tool calls.
   * @issue #749
   */
  private cleanThinkingContent(thought: string): string {
    return this.extractKimiToolCallsFromText(thought).cleanedText;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * @requirement:REQ-LOCAL-001
   * Creates a client scoped to the active runtime metadata without caching.
   * Local endpoints (localhost, private IPs) are allowed without authentication
   * to support local AI servers like Ollama.
   */
  private mergeInvocationHeaders(
    options: NormalizedGenerateChatOptions,
    baseHeaders?: Record<string, string>,
  ): Record<string, string> | undefined {
    const invocationHeadersRaw =
      options.invocation.getEphemeral('custom-headers');
    const invocationHeaders =
      invocationHeadersRaw && typeof invocationHeadersRaw === 'object'
        ? (invocationHeadersRaw as Record<string, string>)
        : undefined;

    const invocationUserAgent = options.invocation.getEphemeral('user-agent');

    return baseHeaders || invocationHeaders || invocationUserAgent
      ? {
          ...(baseHeaders ?? {}),
          ...(invocationHeaders ?? {}),
          ...(typeof invocationUserAgent === 'string' &&
          invocationUserAgent.trim()
            ? { 'User-Agent': invocationUserAgent.trim() }
            : {}),
        }
      : undefined;
  }

  protected async getClient(
    options: NormalizedGenerateChatOptions,
  ): Promise<OpenAI> {
    const authToken =
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;

    // Allow local endpoints without authentication (fixes #598)
    // Local AI servers like Ollama typically don't require API keys
    if (!authToken && !isLocalEndpoint(baseURL)) {
      throw new Error(
        `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).")`,
      );
    }

    const agents = this.createHttpAgents(options);

    // Apply invocation/provider header overrides at client construction time.
    // Some OpenAI-compatible gateways (e.g., Kimi For Coding) enforce allowlisting
    // based on User-Agent, which must be sent as a real HTTP header.
    const headers = this.mergeInvocationHeaders(options);

    return this.instantiateClient(authToken, baseURL, agents, headers);
  }

  /**
   * Check if OAuth is supported for this provider
   * Qwen endpoints support OAuth, standard OpenAI does not
   */
  protected supportsOAuth(): boolean {
    const providerConfig = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };
    if (providerConfig?.forceQwenOAuth) {
      return true;
    }
    // CRITICAL FIX: Check provider name first for cases where base URL is changed by profiles
    // This handles the cerebrasqwen3 profile case where base-url is changed to cerebras.ai
    // but the provider name is still 'qwen' due to Object.defineProperty override
    if (this.name === 'qwen') {
      return true;
    }

    // Fallback to base URL check for direct instantiation
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('dashscope.aliyuncs.com') ||
        baseURL.includes('api.qwen.com') ||
        baseURL.includes('qwen'))
    ) {
      return true;
    }

    // Standard OpenAI endpoints don't support OAuth
    return false;
  }

  override async getModels(): Promise<IModel[]> {
    try {
      // Always try to fetch models, regardless of auth status
      // Local endpoints often work without authentication
      const authToken = await this.getAuthToken();
      const baseURL = this.getBaseURL();
      const agents = this.createHttpAgents();
      const client = this.instantiateClient(authToken, baseURL, agents);
      const response = await client.models.list();
      const models: IModel[] = [];

      for await (const model of response) {
        // Filter out non-chat models (embeddings, audio, image, vision, DALL·E, etc.)
        if (
          !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
            model.id,
          )
        ) {
          models.push({
            id: model.id,
            name: model.id,
            provider: 'openai',
            supportedToolFormats: ['openai'],
          });
        }
      }

      return models;
    } catch (error) {
      this.getLogger().debug(
        () => `Error fetching models from OpenAI: ${error}`,
      );
      // Return a hardcoded list as fallback
      return this.getFallbackModels();
    }
  }

  private getFallbackModels(): IModel[] {
    // Return commonly available OpenAI models as fallback
    return [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4.2-turbo-preview',
        name: 'GPT-4.2 Turbo Preview',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4.2-turbo',
        name: 'GPT-4.2 Turbo',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
    ];
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    // Check if this is a Qwen provider instance based on baseURL
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('qwen') || baseURL.includes('dashscope'))
    ) {
      return process.env.LLXPRT_DEFAULT_MODEL || 'qwen3-coder-plus';
    }
    return process.env.LLXPRT_DEFAULT_MODEL || 'gpt-5';
  }

  /**
   * Get the currently selected model
   */
  override getCurrentModel(): string {
    return this.getModel();
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * No-op retained for compatibility because clients are no longer cached.
   */
  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  public clearClientCache(runtimeKey?: string): void {
    void runtimeKey;
  }

  /**
   * Override isAuthenticated for qwen provider to check OAuth directly
   */
  override async isAuthenticated(): Promise<boolean> {
    const config = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };

    const directApiKey = this.baseProviderConfig.apiKey;
    if (typeof directApiKey === 'string' && directApiKey.trim() !== '') {
      return true;
    }

    try {
      const nonOAuthToken = await this.authResolver.resolveAuthentication({
        settingsService: this.resolveSettingsService(),
        includeOAuth: false,
      });
      if (typeof nonOAuthToken === 'string' && nonOAuthToken.trim() !== '') {
        return true;
      }
    } catch (error) {
      if (process.env.DEBUG) {
        this.getLogger().debug(
          () =>
            `[openai] non-OAuth authentication resolution failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (this.name === 'qwen' && config?.forceQwenOAuth) {
      try {
        const token = await this.authResolver.resolveAuthentication({
          settingsService: this.resolveSettingsService(),
          includeOAuth: true,
        });
        return typeof token === 'string' && token.trim() !== '';
      } catch (error) {
        if (process.env.DEBUG) {
          this.getLogger().debug(
            () =>
              `[openai] forced OAuth authentication failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return false;
      }
    }

    // For non-qwen providers, use the normal check
    return super.isAuthenticated();
  }

  /**
   * Clear all provider state (for provider switching)
   * Clears both OpenAI client cache and auth token cache
   */
  override clearState(): void {
    // Clear OpenAI client cache
    this.clearClientCache();
    // Clear auth token cache from BaseProvider
    this.clearAuthCache();
  }

  override getServerTools(): string[] {
    // TODO: Implement server tools for OpenAI provider
    return [];
  }

  override async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    // TODO: Implement server tool invocation for OpenAI provider
    throw new Error(
      `Server tool '${toolName}' not supported by OpenAI provider`,
    );
  }

  /**
   * Normalize tool IDs from various formats to OpenAI format
   * Handles IDs from OpenAI (call_xxx), Anthropic (toolu_xxx), and history (hist_tool_xxx)
   */
  private normalizeToOpenAIToolId(id: string): string {
    const sanitize = (value: string) =>
      value.replace(/[^a-zA-Z0-9_]/g, '') ||
      'call_' + crypto.randomUUID().replace(/-/g, '');
    // If already in OpenAI format, return as-is
    if (id.startsWith('call_')) {
      return sanitize(id);
    }

    // For history format, extract the UUID and add OpenAI prefix
    if (id.startsWith('hist_tool_')) {
      const uuid = id.substring('hist_tool_'.length);
      return sanitize('call_' + uuid);
    }

    // For Anthropic format, extract the UUID and add OpenAI prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return sanitize('call_' + uuid);
    }

    // Unknown format - assume it's a raw UUID
    return sanitize('call_' + id);
  }

  /**
   * Normalize tool IDs from OpenAI format to history format
   */
  private normalizeToHistoryToolId(id: string): string {
    // If already in history format, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // For OpenAI format, extract the UUID and add history prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'hist_tool_' + uuid;
    }

    // For Anthropic format, extract the UUID and add history prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'hist_tool_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'hist_tool_' + id;
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   * @pseudocode provider-invocation.md lines 8-12
   */
  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P09
   * @requirement:REQ-SP4-002
   * Generate chat completion with per-call client instantiation.
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const callFormatter = this.createToolFormatter();
    const client = await this.getClient(options);
    const runtimeKey = this.resolveRuntimeKey(options);
    const { tools } = options;
    const logger = new DebugLogger('llxprt:provider:openai');

    // Debug log what we receive
    if (logger.enabled) {
      logger.debug(
        () => `[OpenAIProvider] generateChatCompletion received tools:`,
        {
          hasTools: !!tools,
          toolsLength: tools?.length,
          toolsType: typeof tools,
          isArray: Array.isArray(tools),
          firstToolName: tools?.[0]?.functionDeclarations?.[0]?.name,
          toolsStructure: tools ? 'available' : 'undefined',
          runtimeKey,
        },
      );
    }

    // Pass tools directly in Gemini format - they'll be converted per call
    const generator = this.generateChatCompletionImpl(
      options,
      callFormatter,
      client,
      logger,
    );

    for await (const item of generator) {
      yield item;
    }
  }

  private normalizeToolCallArguments(parameters: unknown): string {
    if (parameters === undefined || parameters === null) {
      return '{}';
    }

    if (typeof parameters === 'string') {
      const trimmed = parameters.trim();
      if (!trimmed) {
        return '{}';
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return JSON.stringify(parsed);
        }
        return JSON.stringify({ value: parsed });
      } catch {
        return JSON.stringify({ raw: trimmed });
      }
    }

    if (typeof parameters === 'object') {
      try {
        return JSON.stringify(parameters);
      } catch {
        return JSON.stringify({ raw: '[unserializable object]' });
      }
    }

    return JSON.stringify({ value: parameters });
  }

  private buildToolResponseContent(
    block: ToolResponseBlock,
    config?: Config,
  ): string {
    const payload = buildToolResponsePayload(block, config);
    return ensureJsonSafe(JSON.stringify(payload));
  }

  private shouldCompressToolMessages(
    error: unknown,
    logger: DebugLogger,
  ): boolean {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 400
    ) {
      const raw =
        error &&
        typeof error === 'object' &&
        'error' in error &&
        typeof (error as { error?: { metadata?: { raw?: string } } }).error ===
          'object'
          ? ((error as { error?: { metadata?: { raw?: string } } }).error ?? {})
              .metadata?.raw
          : undefined;
      if (raw === 'ERROR') {
        logger.debug(
          () =>
            `[OpenAIProvider] Detected OpenRouter 400 response with raw metadata. Will attempt tool-response compression.`,
        );
        return true;
      }
    }
    return false;
  }

  private compressToolMessages(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    maxLength: number,
    logger: DebugLogger,
  ): boolean {
    let modified = false;
    messages.forEach((message, index) => {
      if (message.role !== 'tool' || typeof message.content !== 'string') {
        return;
      }
      const original = message.content;
      if (original.length <= maxLength) {
        return;
      }

      let nextContent = original;
      try {
        const parsed = JSON.parse(original) as {
          result?: unknown;
          truncated?: boolean;
          originalLength?: number;
        };
        parsed.result = `[omitted ${original.length} chars due to provider limits]`;
        parsed.truncated = true;
        parsed.originalLength = original.length;
        nextContent = JSON.stringify(parsed);
      } catch {
        nextContent = `${original.slice(0, maxLength)}… [truncated ${original.length - maxLength} chars]`;
      }

      message.content = ensureJsonSafe(nextContent);
      modified = true;
      logger.debug(
        () =>
          `[OpenAIProvider] Compressed tool message #${index} from ${original.length} chars to ${message.content.length} chars`,
      );
    });
    return modified;
  }

  /**
   * Build messages with optional reasoning_content based on settings.
   *
   * @plan PLAN-20251202-THINKING.P14
   * @requirement REQ-THINK-004, REQ-THINK-006
   */
  private buildMessagesWithReasoning(
    contents: IContent[],
    options: NormalizedGenerateChatOptions,
    toolFormat?: ToolFormat,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    // Read settings with defaults
    const stripPolicy =
      (options.settings.get('reasoning.stripFromContext') as StripPolicy) ??
      'none';
    const includeInContext =
      (options.settings.get('reasoning.includeInContext') as boolean) ?? false;

    // Apply strip policy first
    const filteredContents = filterThinkingForContext(contents, stripPolicy);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // Create a ToolIdMapper based on the tool format
    // For Kimi K2, this generates sequential IDs in the format functions.{name}:{index}
    // For Mistral, this generates 9-char alphanumeric IDs
    const toolIdMapper: ToolIdMapper | null =
      toolFormat === 'kimi' || toolFormat === 'mistral'
        ? getToolIdStrategy(toolFormat).createMapper(filteredContents)
        : null;

    // Helper to resolve tool call IDs based on format
    const resolveToolCallId = (tc: ToolCallBlock): string => {
      if (toolIdMapper) {
        return toolIdMapper.resolveToolCallId(tc);
      }
      return this.normalizeToOpenAIToolId(tc.id);
    };

    // Helper to resolve tool response IDs based on format
    const resolveToolResponseId = (tr: ToolResponseBlock): string => {
      if (toolIdMapper) {
        return toolIdMapper.resolveToolResponseId(tr);
      }
      return this.normalizeToOpenAIToolId(tr.callId);
    };

    for (const content of filteredContents) {
      if (content.speaker === 'human') {
        // Convert human messages to user messages
        const textBlocks = content.blocks.filter(
          (b): b is TextBlock => b.type === 'text',
        );
        const text = textBlocks.map((b) => b.text).join('\n');
        if (text) {
          messages.push({
            role: 'user',
            content: text,
          });
        }
      } else if (content.speaker === 'ai') {
        // Convert AI messages with optional reasoning_content
        const textBlocks = content.blocks.filter(
          (b): b is TextBlock => b.type === 'text',
        );
        const text = textBlocks.map((b) => b.text).join('\n');
        const thinkingBlocks = extractThinkingBlocks(content);
        const toolCalls = content.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        if (toolCalls.length > 0) {
          // Assistant message with tool calls
          // CRITICAL for Mistral API compatibility (#760):
          // When tool_calls are present, we must NOT include a content property at all
          // (not even null). Mistral's OpenAI-compatible API requires this.
          // See: https://docs.mistral.ai/capabilities/function_calling
          const baseMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            tool_calls: toolCalls.map((tc) => ({
              id: resolveToolCallId(tc),
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: this.normalizeToolCallArguments(tc.parameters),
              },
            })),
          };

          if (includeInContext && thinkingBlocks.length > 0) {
            const messageWithReasoning = baseMessage as unknown as Record<
              string,
              unknown
            >;
            messageWithReasoning.reasoning_content =
              thinkingToReasoningField(thinkingBlocks);
            messages.push(
              messageWithReasoning as unknown as OpenAI.Chat.ChatCompletionMessageParam,
            );
          } else {
            messages.push(baseMessage);
          }
        } else if (textBlocks.length > 0 || thinkingBlocks.length > 0) {
          // Plain assistant message
          const baseMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            content: text,
          };

          if (includeInContext && thinkingBlocks.length > 0) {
            const messageWithReasoning = baseMessage as unknown as Record<
              string,
              unknown
            >;
            messageWithReasoning.reasoning_content =
              thinkingToReasoningField(thinkingBlocks);
            messages.push(
              messageWithReasoning as unknown as OpenAI.Chat.ChatCompletionMessageParam,
            );
          } else {
            messages.push(baseMessage);
          }
        }
      } else if (content.speaker === 'tool') {
        // Convert tool responses
        const toolResponses = content.blocks.filter(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock[];
        for (const tr of toolResponses) {
          // CRITICAL for Mistral API compatibility (#760):
          // Tool messages must include a name field matching the function name.
          // See: https://docs.mistral.ai/capabilities/function_calling
          // Note: The OpenAI SDK types don't include name, but Mistral requires it.
          // We use a type assertion to add this required field.
          messages.push({
            role: 'tool',
            content: this.buildToolResponseContent(tr, options.config),
            tool_call_id: resolveToolResponseId(tr),
            name: tr.toolName,
          } as OpenAI.Chat.ChatCompletionToolMessageParam);
        }
      }
    }

    // Validate tool message sequence to prevent API errors
    return this.validateToolMessageSequence(messages);
  }

  /**
   * Validates tool message sequence to ensure each tool message has a corresponding tool_calls
   * This prevents "messages with role 'tool' must be a response to a preceeding message with 'tool_calls'" errors
   *
   * Only validates when there are tool_calls present in conversation to avoid breaking isolated tool response tests
   *
   * @param messages - The converted OpenAI messages to validate
   * @returns The validated messages with invalid tool messages removed
   */
  private validateToolMessageSequence(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const logger = this.getLogger();
    const validatedMessages = [...messages];
    let removedCount = 0;

    // Debug: Log the full message sequence for tool call analysis
    logger.debug(
      () =>
        `[OpenAIProvider] validateToolMessageSequence: analyzing ${messages.length} messages`,
      {
        messageRoles: messages.map((m) => m.role),
        toolCallIds: messages
          .filter(
            (m) =>
              m.role === 'assistant' &&
              'tool_calls' in m &&
              Array.isArray(m.tool_calls),
          )
          .flatMap(
            (m) =>
              (
                m as OpenAI.Chat.ChatCompletionAssistantMessageParam
              ).tool_calls?.map((tc) => tc.id) ?? [],
          ),
        toolResponseIds: messages
          .filter((m) => m.role === 'tool')
          .map((m) => (m as { tool_call_id?: string }).tool_call_id),
      },
    );

    // Check if there are any tool_calls in conversation
    // If no tool_calls exist, this might be isolated tool response testing - skip validation
    const hasToolCallsInConversation = validatedMessages.some(
      (msg) =>
        msg.role === 'assistant' &&
        'tool_calls' in msg &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0,
    );

    // Only validate if there are tool_calls in conversation
    if (!hasToolCallsInConversation) {
      return validatedMessages;
    }

    // Track the most recent assistant's tool_call IDs and already consumed tool_call_ids
    let lastAssistantToolCallIds: string[] = [];
    const consumedToolCallIds = new Set<string>();

    // Iterate through messages to check tool message sequence
    for (let i = 0; i < validatedMessages.length; i++) {
      const current = validatedMessages[i];

      if (
        current.role === 'assistant' &&
        'tool_calls' in current &&
        Array.isArray(current.tool_calls)
      ) {
        // Update lastAssistantToolCallIds and reset consumed set when we encounter a new assistant message with tool_calls
        lastAssistantToolCallIds = current.tool_calls.map((tc) => tc.id);
        consumedToolCallIds.clear();
      } else if (current.role === 'tool') {
        // Validate tool message against the last assistant's tool_calls
        const isValidToolCall = lastAssistantToolCallIds.includes(
          current.tool_call_id || '',
        );
        const isDuplicate = consumedToolCallIds.has(current.tool_call_id || '');

        let removalReason: string | undefined;

        if (!isValidToolCall) {
          removalReason = 'tool_call_id not found in last assistant tool_calls';
        } else if (isDuplicate) {
          removalReason = 'duplicate tool_call_id already consumed';
        }

        if (removalReason) {
          // Log the invalid sequence for debugging
          logger.warn(
            `[OpenAIProvider] Invalid tool message sequence detected - removing orphaned tool message: ${removalReason}`,
            {
              currentIndex: i,
              toolCallId: current.tool_call_id,
              lastAssistantToolCallIds,
              consumedToolCallIds: Array.from(consumedToolCallIds),
              removalReason,
            },
          );

          // Remove the invalid tool message
          validatedMessages.splice(i, 1);
          i--; // Adjust index since we removed an element
          removedCount++;
        } else {
          // Mark this tool_call_id as consumed
          if (current.tool_call_id) {
            consumedToolCallIds.add(current.tool_call_id);
          }
        }
      } else if (current.role !== 'assistant') {
        // Clear lastAssistantToolCallIds when we encounter a non-assistant message
        lastAssistantToolCallIds = [];
        consumedToolCallIds.clear();
      }
    }

    // Log summary if any messages were removed
    if (removedCount > 0) {
      logger.debug(
        `[OpenAIProvider] Tool message sequence validation completed - removed ${removedCount} orphaned tool messages`,
        {
          originalMessageCount: messages.length,
          validatedMessageCount: validatedMessages.length,
          removedCount,
        },
      );
    }

    return validatedMessages;
  }

  private getContentPreview(
    content: OpenAI.Chat.ChatCompletionMessageParam['content'],
    maxLength = 200,
  ): string | undefined {
    if (content === null || content === undefined) {
      return undefined;
    }

    if (typeof content === 'string') {
      if (content.length <= maxLength) {
        return content;
      }
      return `${content.slice(0, maxLength)}…`;
    }

    if (Array.isArray(content)) {
      const textParts = content
        .filter(
          (part): part is { type: 'text'; text: string } =>
            typeof part === 'object' && part !== null && 'type' in part,
        )
        .map((part) =>
          part.type === 'text' && typeof part.text === 'string'
            ? part.text
            : JSON.stringify(part),
        );
      const joined = textParts.join('\n');
      if (joined.length <= maxLength) {
        return joined;
      }
      return `${joined.slice(0, maxLength)}…`;
    }

    try {
      const serialized = JSON.stringify(content);
      if (serialized.length <= maxLength) {
        return serialized;
      }
      return `${serialized.slice(0, maxLength)}…`;
    } catch {
      return '[unserializable content]';
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Legacy implementation for chat completion using accumulated tool calls approach
   */
  private async *generateLegacyChatCompletionImpl(
    options: NormalizedGenerateChatOptions,
    toolFormatter: ToolFormatter,
    client: OpenAI,
    logger: DebugLogger,
  ): AsyncGenerator<IContent, void, unknown> {
    const { contents, tools, metadata } = options;
    const model = options.resolved.model || this.getDefaultModel();
    const abortSignal = metadata?.abortSignal as AbortSignal | undefined;
    const ephemeralSettings = options.invocation?.ephemerals ?? {};

    if (logger.enabled) {
      const resolved = options.resolved;
      logger.debug(() => `[OpenAIProvider] Resolved request context`, {
        provider: this.name,
        model,
        resolvedModel: resolved.model,
        resolvedBaseUrl: resolved.baseURL,
        authTokenPresent: Boolean(resolved.authToken),
        messageCount: contents.length,
        toolCount: tools?.length ?? 0,
        metadataKeys: Object.keys(metadata ?? {}),
      });
    }

    // Detect the tool format to use BEFORE building messages
    // This is needed so that Kimi K2 tool IDs can be generated in the correct format
    const detectedFormat = this.detectToolFormat();

    // Log the detected format for debugging
    logger.debug(
      () =>
        `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
      {
        model,
        detectedFormat,
        provider: this.name,
      },
    );

    // Convert IContent to OpenAI messages format
    // Use buildMessagesWithReasoning for reasoning-aware message building
    // Pass detectedFormat so that Kimi K2 tool IDs are generated correctly
    const messages = this.buildMessagesWithReasoning(
      contents,
      options,
      detectedFormat,
    );

    // Convert Gemini format tools to OpenAI format using the schema converter
    // This ensures required fields are always present in tool schemas
    let formattedTools: OpenAITool[] | undefined = convertToolsToOpenAI(tools);

    // CRITICAL FIX: Ensure we never pass an empty tools array
    // The OpenAI API errors when tools=[] but a tool call is attempted
    if (Array.isArray(formattedTools) && formattedTools.length === 0) {
      logger.warn(
        () =>
          `[OpenAIProvider] CRITICAL: Formatted tools is empty array! Setting to undefined to prevent API errors.`,
        {
          model,
          inputTools: tools,
          inputToolsLength: tools?.length,
          inputFirstGroup: tools?.[0],
          stackTrace: new Error().stack,
        },
      );
      formattedTools = undefined;
    }

    // Debug log the conversion result - enhanced logging for intermittent issues
    if (logger.enabled && formattedTools) {
      logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
        detectedFormat,
        inputHadTools: !!tools,
        inputToolsLength: tools?.length,
        inputFirstGroup: tools?.[0],
        inputFunctionDeclarationsLength:
          tools?.[0]?.functionDeclarations?.length,
        outputHasTools: !!formattedTools,
        outputToolsLength: formattedTools?.length,
        outputToolNames: formattedTools?.map((t) => t.function.name),
      });
      logger.debug(() => `[OpenAIProvider] Tool conversion detail`, {
        tools: formattedTools,
      });
    }

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting = ephemeralSettings['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Get the system prompt
    const flattenedToolNames =
      tools?.flatMap((group) =>
        group.functionDeclarations
          .map((decl) => decl.name)
          .filter((name): name is string => !!name),
      ) ?? [];
    const toolNamesArg =
      tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-003
     * Source user memory from normalized options instead of global config
     */
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation?.userMemory,
    );
    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      model,
      toolNamesArg,
    );

    // Add system prompt as the first message in the array
    const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Chat payload snapshot`, {
        messageCount: messagesWithSystem.length,
        messages: messagesWithSystem.map((msg) => ({
          role: msg.role,
          contentPreview: this.getContentPreview(msg.content),
          contentLength:
            typeof msg.content === 'string' ? msg.content.length : undefined,
          rawContent: typeof msg.content === 'string' ? msg.content : undefined,
          toolCallCount:
            'tool_calls' in msg && Array.isArray(msg.tool_calls)
              ? msg.tool_calls.length
              : undefined,
          toolCalls:
            'tool_calls' in msg && Array.isArray(msg.tool_calls)
              ? msg.tool_calls.map((call) => {
                  if (call.type === 'function') {
                    const args = call.function.arguments ?? '';
                    const preview =
                      typeof args === 'string' &&
                      args.length > TOOL_ARGS_PREVIEW_LENGTH
                        ? `${args.slice(0, TOOL_ARGS_PREVIEW_LENGTH)}…`
                        : args;
                    return {
                      id: call.id,
                      name: call.function.name,
                      argumentsPreview: preview,
                    };
                  }
                  return { id: call.id, type: call.type };
                })
              : undefined,
          toolCallId:
            'tool_call_id' in msg
              ? (msg as { tool_call_id?: string }).tool_call_id
              : undefined,
        })),
      });
    }

    const maxTokens =
      (metadata?.maxTokens as number | undefined) ??
      (ephemeralSettings['max-tokens'] as number | undefined);

    // Build request - only include tools if they exist and are not empty
    // IMPORTANT: Create a deep copy of tools to prevent mutation issues
    const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messagesWithSystem,
      stream: streamingEnabled,
    };

    if (formattedTools && formattedTools.length > 0) {
      // Attach tool definitions; they are not mutated by compression logic
      requestBody.tools = formattedTools;
      requestBody.tool_choice = 'auto';
    }

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-002
     * Extract per-call request overrides from normalized options instead of cached state
     */
    const requestOverrides = this.extractModelParamsFromOptions(options);
    if (requestOverrides) {
      if (logger.enabled) {
        logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
          overrideKeys: Object.keys(requestOverrides),
        });
      }
      Object.assign(requestBody, requestOverrides);
    }

    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
      requestBody.max_tokens = maxTokens;
    }

    // Debug log request summary for Cerebras/Qwen
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();

    if (
      logger.enabled &&
      (model.toLowerCase().includes('qwen') || baseURL?.includes('cerebras'))
    ) {
      logger.debug(() => `Request to ${baseURL} for model ${model}:`, {
        baseURL,
        model,
        streamingEnabled,
        hasTools: 'tools' in requestBody,
        toolCount: formattedTools?.length || 0,
        messageCount: messages.length,
        toolsInRequest:
          'tools' in requestBody ? requestBody.tools?.length : 'not included',
      });
    }

    // Get retry settings from ephemeral settings
    const maxRetries =
      (ephemeralSettings['retries'] as number | undefined) ?? 6; // Default for OpenAI
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000; // Default for OpenAI

    // Get stream options from ephemeral settings (default: include usage for token tracking)
    const streamOptions = (ephemeralSettings['stream-options'] as
      | { include_usage?: boolean }
      | undefined) || { include_usage: true };

    // Add stream options to request if streaming is enabled
    if (streamingEnabled && streamOptions) {
      Object.assign(requestBody, { stream_options: streamOptions });
    }

    // Log the exact tools being sent for debugging
    if (logger.enabled && 'tools' in requestBody) {
      logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
        toolCount: requestBody.tools?.length,
        toolNames: requestBody.tools?.map((t) =>
          'function' in t ? t.function?.name : undefined,
        ),
        firstTool: requestBody.tools?.[0],
      });
    }

    // Wrap the API call with retry logic using centralized retry utility
    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Sending chat request`, {
        model,
        baseURL: baseURL ?? this.getBaseURL(),
        streamingEnabled,
        toolCount: formattedTools?.length ?? 0,
        hasAuthToken: Boolean(options.resolved.authToken),
        requestHasSystemPrompt: Boolean(systemPrompt?.length),
        messageCount: messagesWithSystem.length,
      });
      logger.debug(() => `[OpenAIProvider] Request body detail`, {
        body: requestBody,
      });
    }
    // Debug log throttle tracker status
    logger.debug(() => `Retry configuration:`, {
      hasThrottleTracker: !!this.throttleTracker,
      throttleTrackerType: typeof this.throttleTracker,
      maxRetries,
      initialDelayMs,
    });

    const customHeaders = this.getCustomHeaders();

    // Merge invocation ephemerals (CLI /set, alias ephemerals) into custom headers.
    // BaseProvider#getCustomHeaders() reads from providerConfig ephemerals; for stateless
    // calls we also need to respect options.invocation.ephemerals.
    const mergedHeaders = this.mergeInvocationHeaders(options, customHeaders);

    if (logger.enabled && mergedHeaders) {
      logger.debug(
        () =>
          `[OpenAIProvider] Applying merged request headers (custom + invocation + user-agent)`,
        {
          headerKeys: Object.keys(mergedHeaders),
        },
      );
    }

    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Request body preview`, {
        model: requestBody.model,
        hasStop: 'stop' in requestBody,
        hasMaxTokens: 'max_tokens' in requestBody,
        hasResponseFormat: 'response_format' in requestBody,
        overrideKeys: requestOverrides ? Object.keys(requestOverrides) : [],
      });
    }

    // Track failover client - only rebuilt after bucket failover succeeds
    // @plan PLAN-20251213issue686 Fix: client must be rebuilt after bucket failover
    let failoverClient: OpenAI | null = null;

    // Bucket failover callback for 429 errors
    // @plan PLAN-20251213issue686 Bucket failover integration for OpenAIProvider
    const onPersistent429Callback = async (): Promise<boolean | null> => {
      const { result, client } = await this.handleBucketFailoverOnPersistent429(
        options,
        logger,
      );
      if (client) {
        failoverClient = client;
      }
      return result;
    };

    // Use failover client if bucket failover happened, otherwise use original client
    const executeRequest = () => {
      const currentClient = failoverClient ?? client;
      return currentClient.chat.completions.create(requestBody, {
        ...(abortSignal ? { signal: abortSignal } : {}),
        ...(mergedHeaders ? { headers: mergedHeaders } : {}),
      });
    };

    let response:
      | OpenAI.Chat.Completions.ChatCompletion
      | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
      | undefined;

    if (streamingEnabled) {
      response = await retryWithBackoff(executeRequest, {
        maxAttempts: maxRetries,
        initialDelayMs,
        shouldRetryOnError: this.shouldRetryResponse.bind(this),
        trackThrottleWaitTime: this.throttleTracker,
        onPersistent429: onPersistent429Callback,
      });
    } else {
      let compressedOnce = false;
      while (true) {
        try {
          response = (await retryWithBackoff(executeRequest, {
            maxAttempts: maxRetries,
            initialDelayMs,
            shouldRetryOnError: this.shouldRetryResponse.bind(this),
            trackThrottleWaitTime: this.throttleTracker,
            onPersistent429: onPersistent429Callback,
          })) as OpenAI.Chat.Completions.ChatCompletion;
          break;
        } catch (error) {
          const errorMessage = String(error);
          logger.debug(() => `[OpenAIProvider] Chat request error`, {
            errorType: error?.constructor?.name,
            status:
              typeof error === 'object' && error && 'status' in error
                ? (error as { status?: number }).status
                : undefined,
            errorKeys:
              error && typeof error === 'object' ? Object.keys(error) : [],
          });
          const isCerebrasToolError =
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'));

          if (isCerebrasToolError) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }

          if (
            !compressedOnce &&
            this.shouldCompressToolMessages(error, logger) &&
            this.compressToolMessages(requestBody.messages, 512, logger)
          ) {
            compressedOnce = true;
            logger.warn(
              () =>
                `[OpenAIProvider] Retrying request after compressing tool responses due to provider 400`,
            );
            continue;
          }

          const capturedErrorMessage =
            error instanceof Error ? error.message : String(error);
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status: unknown }).status === 'number'
              ? (error as { status: number }).status
              : undefined;

          logger.error(
            () =>
              `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? this.getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
            {
              model,
              baseURL: baseURL ?? this.getBaseURL(),
              streamingEnabled,
              hasTools: formattedTools?.length ?? 0,
              requestHasSystemPrompt: !!systemPrompt,
              status,
            },
          );
          throw error;
        }
      }
    }

    // Check if response is streaming or not
    if (streamingEnabled) {
      // Process streaming response
      let _accumulatedText = '';
      const accumulatedToolCalls: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }> = [];

      // Buffer for accumulating text chunks for providers that need it
      let textBuffer = '';
      // Use the same detected format from earlier for consistency
      const isKimiK2Model = model.toLowerCase().includes('kimi-k2');
      // Buffer text for Qwen format providers and Kimi-K2 to avoid stanza formatting
      const shouldBufferText = detectedFormat === 'qwen' || isKimiK2Model;

      // Accumulate thinking content across the entire stream to emit as ONE block
      // This handles fragmented <think>word</think> streaming from Synthetic API
      // @plan PLAN-20251202-THINKING.P16
      let accumulatedThinkingContent = '';
      let hasEmittedThinking = false;

      // Accumulate reasoning_content from streaming deltas (legacy path)
      // Synthetic API sends reasoning token-by-token, so we accumulate to emit ONE block
      // @plan PLAN-20251202-THINKING.P16
      let accumulatedReasoningContent = '';

      // Track token usage from streaming chunks
      let streamingUsage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | null = null;

      // Track total chunks for debugging empty responses
      let totalChunksReceived = 0;

      // Track finish_reason for detecting empty responses (issue #584)
      let lastFinishReason: string | null | undefined = null;

      try {
        // Handle streaming response
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          totalChunksReceived++;
          if (abortSignal?.aborted) {
            break;
          }

          // Debug: Log first few chunks and every 10th chunk to understand stream behavior
          if (totalChunksReceived <= 3 || totalChunksReceived % 10 === 0) {
            logger.debug(
              () => `[Streaming legacy] Chunk #${totalChunksReceived} received`,
              {
                hasChoices: !!chunk.choices?.length,
                firstChoiceDelta: chunk.choices?.[0]?.delta,
                finishReason: chunk.choices?.[0]?.finish_reason,
              },
            );
          }

          const chunkRecord = chunk as unknown as Record<string, unknown>;
          let parsedData: Record<string, unknown> | undefined;
          const rawData = chunkRecord?.data;
          if (typeof rawData === 'string') {
            try {
              parsedData = JSON.parse(rawData) as Record<string, unknown>;
            } catch {
              parsedData = undefined;
            }
          } else if (rawData && typeof rawData === 'object') {
            parsedData = rawData as Record<string, unknown>;
          }

          const streamingError =
            chunkRecord?.error ??
            parsedData?.error ??
            (parsedData?.data as { error?: unknown } | undefined)?.error;
          const streamingEvent = (chunkRecord?.event ?? parsedData?.event) as
            | string
            | undefined;
          const streamingErrorMessage =
            (streamingError as { message?: string } | undefined)?.message ??
            (streamingError as { error?: string } | undefined)?.error ??
            (parsedData as { message?: string } | undefined)?.message;
          if (
            streamingEvent === 'error' ||
            (streamingError && typeof streamingError === 'object')
          ) {
            const errorMessage =
              streamingErrorMessage ??
              (typeof streamingError === 'string'
                ? streamingError
                : 'Streaming response reported an error.');
            throw new Error(errorMessage);
          }

          // Extract usage information if present (typically in final chunk)
          if (chunk.usage) {
            streamingUsage = chunk.usage;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Parse reasoning_content from streaming delta (Phase 16 integration)
          // ACCUMULATE instead of yielding immediately to handle token-by-token streaming
          // Extract embedded Kimi K2 tool calls from reasoning_content (fixes #749)
          // @plan PLAN-20251202-THINKING.P16
          // @requirement REQ-KIMI-REASONING-001.1
          const { thinking: reasoningBlock, toolCalls: reasoningToolCalls } =
            this.parseStreamingReasoningDelta(choice.delta);
          if (reasoningBlock) {
            // Accumulate reasoning content - will emit ONE block later
            accumulatedReasoningContent += reasoningBlock.thought;
          }
          // Accumulate tool calls extracted from reasoning_content
          if (reasoningToolCalls.length > 0) {
            for (const toolCall of reasoningToolCalls) {
              // Convert ToolCallBlock to accumulated format
              const index = accumulatedToolCalls.length;
              accumulatedToolCalls[index] = {
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.parameters),
                },
              };
            }
          }

          // Check for finish_reason to detect proper stream ending
          if (choice.finish_reason) {
            lastFinishReason = choice.finish_reason;
            logger.debug(
              () =>
                `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
              {
                model,
                finishReason: choice.finish_reason,
                hasAccumulatedText: _accumulatedText.length > 0,
                hasAccumulatedTools: accumulatedToolCalls.length > 0,
                hasBufferedText: textBuffer.length > 0,
              },
            );

            // If finish_reason is 'length', the response was cut off
            if (choice.finish_reason === 'length') {
              logger.debug(
                () =>
                  `Response truncated due to length limit for model ${model}`,
              );
            }

            // Don't flush buffer here on finish - let the final buffer handling
            // after the loop process it with proper sanitization and think tag extraction
            // This was causing unsanitized <think> tags to leak into output (legacy path)
            // @plan PLAN-20251202-THINKING.P16
          }

          // Handle text content - buffer for Qwen format, emit immediately for others
          // Note: Synthetic API sends content that may duplicate reasoning_content.
          // We now filter duplicates by tracking when content starts matching reasoning_content.
          // fixes #721
          // @plan PLAN-20251202-THINKING.P16
          const rawDeltaContent = this.coerceMessageContentToString(
            choice.delta?.content as unknown,
          );
          if (rawDeltaContent) {
            // For Kimi models, we need to buffer the RAW content without processing
            // because Kimi tokens stream incrementally and partial tokens would leak
            // through if we try to process them immediately. The buffer will be
            // processed when flushed (at sentence boundaries or end of stream).
            let deltaContent: string;
            if (isKimiK2Model) {
              // For Kimi: Don't process yet - just pass through and let buffering handle it
              // We'll extract tool calls and sanitize when we flush the buffer
              deltaContent = rawDeltaContent;
            } else {
              // For non-Kimi models: sanitize immediately as before
              deltaContent = this.sanitizeProviderText(rawDeltaContent);
            }
            if (!deltaContent) {
              continue;
            }

            _accumulatedText += deltaContent;

            // Debug log for providers that need buffering
            if (shouldBufferText) {
              logger.debug(
                () => `[Streaming] Chunk content for ${detectedFormat} format:`,
                {
                  deltaContent,
                  length: deltaContent.length,
                  hasNewline: deltaContent.includes('\n'),
                  escaped: JSON.stringify(deltaContent),
                  bufferSize: textBuffer.length,
                },
              );

              // Buffer text to avoid stanza formatting
              textBuffer += deltaContent;

              const kimiBeginCount = (
                textBuffer.match(/<\|tool_calls_section_begin\|>/g) || []
              ).length;
              const kimiEndCount = (
                textBuffer.match(/<\|tool_calls_section_end\|>/g) || []
              ).length;
              const hasOpenKimiSection = kimiBeginCount > kimiEndCount;

              // Emit buffered text when we have a complete sentence or paragraph
              // Look for natural break points, but avoid flushing mid Kimi section
              if (
                !hasOpenKimiSection &&
                (textBuffer.includes('\n') ||
                  textBuffer.endsWith('. ') ||
                  textBuffer.endsWith('! ') ||
                  textBuffer.endsWith('? ') ||
                  textBuffer.length > 100)
              ) {
                const parsedToolCalls: ToolCallBlock[] = [];
                let workingText = textBuffer;

                // Extract <think> tags and ACCUMULATE instead of emitting immediately (legacy path)
                // This handles fragmented <think>word</think> streaming from Synthetic API
                // @plan PLAN-20251202-THINKING.P16
                // @requirement REQ-THINK-003
                const tagBasedThinking =
                  this.extractThinkTagsAsBlock(workingText);
                if (tagBasedThinking) {
                  // Clean Kimi tokens from thinking content before accumulating
                  const cleanedThought = this.cleanThinkingContent(
                    tagBasedThinking.thought,
                  );
                  // Accumulate thinking content - don't emit yet
                  // Use newline to preserve formatting between chunks (not space)
                  if (accumulatedThinkingContent.length > 0) {
                    accumulatedThinkingContent += '\n';
                  }
                  accumulatedThinkingContent += cleanedThought;
                  logger.debug(
                    () =>
                      `[Streaming legacy] Accumulated thinking: ${accumulatedThinkingContent.length} chars total`,
                  );
                }

                const kimiParsed =
                  this.extractKimiToolCallsFromText(workingText);
                if (kimiParsed.toolCalls.length > 0) {
                  parsedToolCalls.push(...kimiParsed.toolCalls);
                  logger.debug(
                    () =>
                      `[OpenAIProvider] Streaming buffer (legacy) parsed Kimi tool calls`,
                    {
                      count: kimiParsed.toolCalls.length,
                      bufferLength: workingText.length,
                      cleanedLength: kimiParsed.cleanedText.length,
                    },
                  );
                }
                workingText = kimiParsed.cleanedText;

                const parsingText = this.sanitizeProviderText(workingText);
                let cleanedText = parsingText;
                try {
                  const parsedResult = this.textToolParser.parse(parsingText);
                  if (parsedResult.toolCalls.length > 0) {
                    parsedToolCalls.push(
                      ...parsedResult.toolCalls.map((call) => ({
                        type: 'tool_call' as const,
                        id: `text_tool_${Date.now()}_${Math.random()
                          .toString(36)
                          .substring(7)}`,
                        name: this.normalizeToolName(call.name),
                        parameters: call.arguments,
                      })),
                    );
                    cleanedText = parsedResult.cleanedContent;
                  }
                } catch (error) {
                  const logger = this.getLogger();
                  logger.debug(
                    () =>
                      `TextToolCallParser failed on buffered text: ${error}`,
                  );
                }

                // Emit accumulated thinking BEFORE tool calls or text content (legacy path)
                // This ensures thinking appears first in the response
                // @plan PLAN-20251202-THINKING.P16
                if (
                  !hasEmittedThinking &&
                  accumulatedThinkingContent.length > 0 &&
                  (parsedToolCalls.length > 0 || cleanedText.trim().length > 0)
                ) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: accumulatedThinkingContent,
                        sourceField: 'think_tags',
                        isHidden: false,
                      } as ThinkingBlock,
                    ],
                  } as IContent;
                  hasEmittedThinking = true;
                  logger.debug(
                    () =>
                      `[Streaming legacy] Emitted accumulated thinking: ${accumulatedThinkingContent.length} chars`,
                  );
                }

                if (parsedToolCalls.length > 0) {
                  yield {
                    speaker: 'ai',
                    blocks: parsedToolCalls,
                  } as IContent;
                }

                // Always use sanitized text to strip <think> tags (legacy streaming)
                // Bug fix: Previously Kimi used unsanitized workingText
                // @plan PLAN-20251202-THINKING.P16
                // Bug fix #721: Emit whitespace-only chunks (e.g., " " between words)
                // Previously we used cleanedText.trim().length > 0 which dropped spaces,
                // causing "list 5" to become "list5". Now we emit any non-empty cleanedText.
                if (cleanedText.length > 0) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'text',
                        text: cleanedText,
                      } as TextBlock,
                    ],
                  } as IContent;
                }

                textBuffer = '';
              }
            } else {
              // For other providers, emit text immediately as before
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: deltaContent,
                  } as TextBlock,
                ],
              } as IContent;
            }
          }

          // Handle tool calls using legacy accumulated approach
          const deltaToolCalls = choice.delta?.tool_calls;
          if (deltaToolCalls && deltaToolCalls.length > 0) {
            for (const deltaToolCall of deltaToolCalls) {
              if (deltaToolCall.index === undefined) continue;

              if (!accumulatedToolCalls[deltaToolCall.index]) {
                accumulatedToolCalls[deltaToolCall.index] = {
                  id: deltaToolCall.id || '',
                  type: 'function',
                  function: {
                    name: deltaToolCall.function?.name || '',
                    arguments: '',
                  },
                };
              }

              const tc = accumulatedToolCalls[deltaToolCall.index];
              if (tc) {
                if (deltaToolCall.id) tc.id = deltaToolCall.id;
                if (deltaToolCall.function?.name)
                  tc.function.name = deltaToolCall.function.name;
                if (deltaToolCall.function?.arguments) {
                  tc.function.arguments += deltaToolCall.function.arguments;
                }
              }
            }
          }

          const choiceMessage = (
            choice as {
              message?: {
                tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
              };
            }
          ).message;
          const messageToolCalls = choiceMessage?.tool_calls;
          if (messageToolCalls && messageToolCalls.length > 0) {
            messageToolCalls.forEach(
              (
                toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
                index: number,
              ) => {
                if (!toolCall || toolCall.type !== 'function') {
                  return;
                }

                if (!accumulatedToolCalls[index]) {
                  accumulatedToolCalls[index] = {
                    id: toolCall.id || '',
                    type: 'function',
                    function: {
                      name: toolCall.function?.name || '',
                      arguments: toolCall.function?.arguments || '',
                    },
                  };
                }
              },
            );
          }
        }
      } catch (error) {
        if (
          abortSignal?.aborted ||
          (error &&
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'AbortError')
        ) {
          // Signal was aborted - treat as intentional cancellation
          logger.debug(
            () =>
              `Legacy streaming response cancelled by AbortSignal (error: ${error instanceof Error ? error.name : 'unknown'})`,
          );
          throw error;
        } else {
          // Special handling for Cerebras/Qwen "Tool not present" errors
          const errorMessage = String(error);
          if (
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'))
          ) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
              },
            );
            // Re-throw but with better context
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list during streaming. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }
          logger.error('Error processing streaming response:', error);
          throw error;
        }
      }

      // Check buffered text for <tool_call> format before flushing as plain text
      if (textBuffer.length > 0) {
        const parsedToolCalls: ToolCallBlock[] = [];
        let workingText = textBuffer;

        // Note: Synthetic API sends reasoning via both reasoning_content AND content fields.
        // This is the model's behavior - we don't strip it since the model is the source.
        // The user can configure reasoning display settings if they don't want duplicates.
        // @plan PLAN-20251202-THINKING.P16

        // Extract any remaining <think> tags from final buffer (legacy path)
        // @plan PLAN-20251202-THINKING.P16
        const tagBasedThinking = this.extractThinkTagsAsBlock(workingText);
        if (tagBasedThinking) {
          // Clean Kimi tokens from thinking content before accumulating
          const cleanedThought = this.cleanThinkingContent(
            tagBasedThinking.thought,
          );
          // Use newline to preserve formatting between chunks (not space)
          if (accumulatedThinkingContent.length > 0) {
            accumulatedThinkingContent += '\n';
          }
          accumulatedThinkingContent += cleanedThought;
        }

        const kimiParsed = this.extractKimiToolCallsFromText(workingText);
        if (kimiParsed.toolCalls.length > 0) {
          parsedToolCalls.push(...kimiParsed.toolCalls);
          this.getLogger().debug(
            () =>
              `[OpenAIProvider] Final buffer flush (legacy) parsed Kimi tool calls`,
            {
              count: kimiParsed.toolCalls.length,
              bufferLength: workingText.length,
              cleanedLength: kimiParsed.cleanedText.length,
            },
          );
        }
        workingText = kimiParsed.cleanedText;

        const parsingText = this.sanitizeProviderText(workingText);
        let cleanedText = parsingText;
        try {
          const parsedResult = this.textToolParser.parse(parsingText);
          if (parsedResult.toolCalls.length > 0) {
            parsedToolCalls.push(
              ...parsedResult.toolCalls.map((call) => ({
                type: 'tool_call' as const,
                id: `text_tool_${Date.now()}_${Math.random()
                  .toString(36)
                  .substring(7)}`,
                name: this.normalizeToolName(call.name),
                parameters: call.arguments,
              })),
            );
            cleanedText = parsedResult.cleanedContent;
          }
        } catch (error) {
          const logger = this.getLogger();
          logger.debug(
            () => `TextToolCallParser failed on buffered text: ${error}`,
          );
        }

        // Emit accumulated thinking BEFORE tool calls or text content (legacy path)
        // @plan PLAN-20251202-THINKING.P16
        if (
          !hasEmittedThinking &&
          accumulatedThinkingContent.length > 0 &&
          (parsedToolCalls.length > 0 || cleanedText.trim().length > 0)
        ) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: accumulatedThinkingContent,
                sourceField: 'think_tags',
                isHidden: false,
              } as ThinkingBlock,
            ],
          } as IContent;
          hasEmittedThinking = true;
        }

        if (parsedToolCalls.length > 0) {
          yield {
            speaker: 'ai',
            blocks: parsedToolCalls,
          } as IContent;
        }

        // Always use sanitized text to strip <think> tags (legacy final buffer)
        // Bug fix: Previously Kimi used unsanitized workingText
        // @plan PLAN-20251202-THINKING.P16
        // Bug fix #721: Emit whitespace-only chunks (e.g., " " between words)
        // Previously we used cleanedText.trim().length > 0 which dropped spaces,
        // causing "list 5" to become "list5". Now we emit any non-empty cleanedText.
        if (cleanedText.length > 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: cleanedText,
              } as TextBlock,
            ],
          } as IContent;
        }

        textBuffer = '';
      }

      // Emit any remaining accumulated thinking that wasn't emitted yet (legacy path)
      // (e.g., if entire response was just thinking with no content)
      // @plan PLAN-20251202-THINKING.P16
      if (!hasEmittedThinking && accumulatedThinkingContent.length > 0) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: accumulatedThinkingContent,
              sourceField: 'think_tags',
              isHidden: false,
            } as ThinkingBlock,
          ],
        } as IContent;
        hasEmittedThinking = true;
      }

      // Emit accumulated reasoning_content as ONE ThinkingBlock (legacy path)
      // This consolidates token-by-token reasoning from Synthetic API into a single block
      // Clean Kimi tokens from the accumulated content (not per-chunk) to handle split tokens
      // @plan PLAN-20251202-THINKING.P16
      if (accumulatedReasoningContent.length > 0) {
        // Extract Kimi tool calls from the complete accumulated reasoning content
        const { cleanedText: cleanedReasoning, toolCalls: reasoningToolCalls } =
          this.extractKimiToolCallsFromText(accumulatedReasoningContent);

        // Emit the cleaned thinking block
        if (cleanedReasoning.length > 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: cleanedReasoning,
                sourceField: 'reasoning_content',
                isHidden: false,
              } as ThinkingBlock,
            ],
          } as IContent;
        }

        // Emit any tool calls extracted from reasoning content
        if (reasoningToolCalls.length > 0) {
          yield {
            speaker: 'ai',
            blocks: reasoningToolCalls,
          } as IContent;
        }
      }

      // Process and emit tool calls using legacy accumulated approach
      if (accumulatedToolCalls.length > 0) {
        const blocks: ToolCallBlock[] = [];

        for (const tc of accumulatedToolCalls) {
          if (!tc) continue;

          const sanitizedArgs = this.sanitizeToolArgumentsString(
            tc.function.arguments,
          );

          // Normalize tool name (handles Kimi-K2 style prefixes)
          const normalizedName = this.normalizeToolName(tc.function.name || '');

          // Process tool parameters with double-escape handling
          const processedParameters = processToolParameters(
            sanitizedArgs,
            normalizedName,
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(tc.id),
            name: normalizedName,
            parameters: processedParameters,
          });
        }

        if (blocks.length > 0) {
          const toolCallsContent: IContent = {
            speaker: 'ai',
            blocks,
          };

          // Add usage metadata if we captured it from streaming
          if (streamingUsage) {
            const cacheMetrics = extractCacheMetrics(streamingUsage);
            toolCallsContent.metadata = {
              usage: {
                promptTokens: streamingUsage.prompt_tokens || 0,
                completionTokens: streamingUsage.completion_tokens || 0,
                totalTokens:
                  streamingUsage.total_tokens ||
                  (streamingUsage.prompt_tokens || 0) +
                    (streamingUsage.completion_tokens || 0),
                cachedTokens: cacheMetrics.cachedTokens,
                cacheCreationTokens: cacheMetrics.cacheCreationTokens,
                cacheMissTokens: cacheMetrics.cacheMissTokens,
              },
            };
          }

          yield toolCallsContent;
        }
      }

      // If we have usage information but no tool calls, emit a metadata-only response
      if (streamingUsage && accumulatedToolCalls.length === 0) {
        const cacheMetrics = extractCacheMetrics(streamingUsage);
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: streamingUsage.prompt_tokens || 0,
              completionTokens: streamingUsage.completion_tokens || 0,
              totalTokens:
                streamingUsage.total_tokens ||
                (streamingUsage.prompt_tokens || 0) +
                  (streamingUsage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          },
        } as IContent;
      }

      // Detect and handle empty streaming responses after tool calls (issue #584)
      // Some models (like gpt-oss-120b on OpenRouter) return finish_reason=stop with tools but no text
      const hasToolsButNoText =
        lastFinishReason === 'stop' &&
        accumulatedToolCalls.length > 0 &&
        _accumulatedText.length === 0 &&
        textBuffer.length === 0 &&
        accumulatedReasoningContent.length === 0 &&
        accumulatedThinkingContent.length === 0;

      if (hasToolsButNoText) {
        logger.log(
          () =>
            `[OpenAIProvider] Model returned tool calls but no text (finish_reason=stop). Requesting continuation for model '${model}'.`,
          {
            model,
            toolCallCount: accumulatedToolCalls.length,
            baseURL: baseURL ?? this.getBaseURL(),
          },
        );

        // Request continuation after tool calls (delegated to shared method)
        const toolCallsForContinuation = accumulatedToolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        }));

        yield* this.requestContinuationAfterToolCalls(
          toolCallsForContinuation,
          messagesWithSystem,
          requestBody,
          client,
          abortSignal,
          model,
          logger,
          customHeaders,
        );
      }

      // Detect and warn about empty streaming responses (common with Kimi K2 after tool calls)
      // Only warn if we truly got nothing - not even reasoning content
      if (
        _accumulatedText.length === 0 &&
        accumulatedToolCalls.length === 0 &&
        textBuffer.length === 0 &&
        accumulatedReasoningContent.length === 0 &&
        accumulatedThinkingContent.length === 0
      ) {
        // Provide actionable guidance for users
        const isKimi = model.toLowerCase().includes('kimi');
        const isSynthetic =
          (baseURL ?? this.getBaseURL())?.includes('synthetic') ?? false;
        const troubleshooting = isKimi
          ? isSynthetic
            ? ' To fix: use streaming: "disabled" in your profile settings. Synthetic API streaming does not work reliably with tool calls.'
            : ' This provider may not support streaming with tool calls.'
          : ' Consider using streaming: "disabled" in your profile settings.';

        logger.warn(
          () =>
            `[OpenAIProvider] Empty streaming response for model '${model}' (received ${totalChunksReceived} chunks with no content).${troubleshooting}`,
          {
            model,
            baseURL: baseURL ?? this.getBaseURL(),
            isKimiModel: isKimi,
            isSyntheticAPI: isSynthetic,
            totalChunksReceived,
          },
        );
      } else {
        // Log what we DID get for debugging
        logger.debug(
          () => `[Streaming legacy] Stream completed with accumulated content`,
          {
            textLength: _accumulatedText.length,
            toolCallCount: accumulatedToolCalls.length,
            textBufferLength: textBuffer.length,
            reasoningLength: accumulatedReasoningContent.length,
            thinkingLength: accumulatedThinkingContent.length,
            totalChunksReceived,
          },
        );
      }
    } else {
      // Handle non-streaming response
      const completion = response as OpenAI.Chat.Completions.ChatCompletion;
      const choice = completion.choices?.[0];

      if (!choice) {
        throw new Error('No choices in completion response');
      }

      // Log finish reason for debugging Qwen issues
      if (choice.finish_reason) {
        logger.debug(
          () =>
            `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
          {
            model,
            finishReason: choice.finish_reason,
            hasContent: !!choice.message?.content,
            hasToolCalls: !!(
              choice.message?.tool_calls && choice.message.tool_calls.length > 0
            ),
            contentLength: choice.message?.content?.length || 0,
            toolCallCount: choice.message?.tool_calls?.length || 0,
            detectedFormat,
          },
        );

        // Warn if the response was truncated
        if (choice.finish_reason === 'length') {
          logger.warn(
            () =>
              `Response truncated due to max_tokens limit for model ${model}. Consider increasing max_tokens.`,
          );
        }
      }

      const blocks: Array<TextBlock | ToolCallBlock | ThinkingBlock> = [];

      // Parse reasoning_content from response (Phase 16 integration)
      // Extract embedded Kimi K2 tool calls from reasoning_content (fixes #749)
      // @requirement REQ-KIMI-REASONING-001.2
      const { thinking: reasoningBlock, toolCalls: reasoningToolCalls } =
        this.parseNonStreamingReasoning(choice.message);
      logger.debug(
        () =>
          `[Non-streaming] parseNonStreamingReasoning result: ${reasoningBlock ? `found (${reasoningBlock.thought?.length} chars)` : 'not found'}, tool calls: ${reasoningToolCalls.length}`,
        {
          hasReasoningContent:
            'reasoning_content' in
            ((choice.message as unknown as Record<string, unknown>) ?? {}),
          messageKeys: Object.keys(
            (choice.message as unknown as Record<string, unknown>) ?? {},
          ),
        },
      );
      if (reasoningBlock) {
        blocks.push(reasoningBlock);
      }
      // Add tool calls extracted from reasoning_content
      if (reasoningToolCalls.length > 0) {
        blocks.push(...reasoningToolCalls);
        logger.debug(
          () =>
            `[Non-streaming] Added ${reasoningToolCalls.length} tool calls from reasoning_content`,
        );
      }

      // Handle text content (strip thinking / reasoning blocks) and Kimi tool sections
      const rawMessageContent = this.coerceMessageContentToString(
        choice.message?.content as unknown,
      );
      let kimiCleanContent: string | undefined;
      let kimiToolBlocks: ToolCallBlock[] = [];

      if (rawMessageContent) {
        // Extract <think> tags as ThinkingBlock BEFORE stripping them
        // Only do this if we didn't already get reasoning from reasoning_content field
        // @plan PLAN-20251202-THINKING.P16
        // @requirement REQ-THINK-003
        if (!reasoningBlock) {
          const tagBasedThinking =
            this.extractThinkTagsAsBlock(rawMessageContent);
          if (tagBasedThinking) {
            blocks.push(tagBasedThinking);
            logger.debug(
              () =>
                `[Non-streaming] Extracted thinking from <think> tags: ${tagBasedThinking.thought.length} chars`,
            );
          }
        }

        const kimiParsed = this.extractKimiToolCallsFromText(rawMessageContent);
        kimiCleanContent = kimiParsed.cleanedText;
        kimiToolBlocks = kimiParsed.toolCalls;

        // Always sanitize text content to remove <think> tags
        // Bug fix: Previously Kimi-K2 used unsanitized kimiCleanContent,
        // which caused <think> tags to leak into visible output
        // @plan PLAN-20251202-THINKING.P16
        const cleanedText = this.sanitizeProviderText(kimiCleanContent);
        if (cleanedText) {
          blocks.push({
            type: 'text',
            text: cleanedText,
          } as TextBlock);
        }
      }

      // Handle tool calls
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        // Use the same detected format from earlier for consistency

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === 'function') {
            // Normalize tool name (handles Kimi-K2 style prefixes)
            const toolName = this.normalizeToolName(
              toolCall.function.name || '',
            );

            const sanitizedArgs = this.sanitizeToolArgumentsString(
              toolCall.function.arguments,
            );

            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              sanitizedArgs,
              toolName,
            );

            blocks.push({
              type: 'tool_call',
              id: this.normalizeToHistoryToolId(toolCall.id),
              name: toolName,
              parameters: processedParameters,
            } as ToolCallBlock);
          }
        }
      }

      // Add any tool calls parsed from Kimi inline sections
      if (kimiToolBlocks.length > 0) {
        blocks.push(...kimiToolBlocks);
        this.getLogger().debug(
          () =>
            `[OpenAIProvider] Non-stream legacy added Kimi tool calls from text`,
          { count: kimiToolBlocks.length },
        );
      }

      // Additionally check for <tool_call> format in text content
      if (kimiCleanContent) {
        const cleanedSource = this.sanitizeProviderText(kimiCleanContent);
        if (cleanedSource) {
          try {
            const parsedResult = this.textToolParser.parse(cleanedSource);
            if (parsedResult.toolCalls.length > 0) {
              // Add tool calls found in text content
              for (const call of parsedResult.toolCalls) {
                blocks.push({
                  type: 'tool_call',
                  id: `text_tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  name: this.normalizeToolName(call.name),
                  parameters: call.arguments,
                } as ToolCallBlock);
              }

              // Update the text content to remove the tool call parts
              if (choice.message.content !== parsedResult.cleanedContent) {
                // Find the text block and update it
                const textBlockIndex = blocks.findIndex(
                  (block) => block.type === 'text',
                );
                if (textBlockIndex >= 0) {
                  (blocks[textBlockIndex] as TextBlock).text =
                    parsedResult.cleanedContent;
                } else if (parsedResult.cleanedContent.trim()) {
                  // Add cleaned text if it doesn't exist
                  blocks.unshift({
                    type: 'text',
                    text: parsedResult.cleanedContent,
                  } as TextBlock);
                }
              }
            }
          } catch (error) {
            const logger = this.getLogger();
            logger.debug(
              () => `TextToolCallParser failed on message content: ${error}`,
            );
          }
        }
      }

      // Emit the complete response as a single IContent
      if (blocks.length > 0) {
        const responseContent: IContent = {
          speaker: 'ai',
          blocks,
        };

        // Add usage metadata from non-streaming response
        if (completion.usage) {
          const cacheMetrics = extractCacheMetrics(completion.usage);
          responseContent.metadata = {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          };
        }

        yield responseContent;
      } else if (completion.usage) {
        // Emit metadata-only response if no content blocks but have usage info
        const cacheMetrics = extractCacheMetrics(completion.usage);
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          },
        } as IContent;
      }
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Memoization of model parameters disabled for stateless provider
   */
  setModelParams(_params: Record<string, unknown> | undefined): void {
    throw new Error(
      'ProviderCacheError("Attempted to memoize model parameters for openai")',
    );
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Gets model parameters from SettingsService per call (stateless)
   */
  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

      const reservedKeys = new Set([
        'enabled',
        'apiKey',
        'api-key',
        'apiKeyfile',
        'api-keyfile',
        'baseUrl',
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      if (providerSettings) {
        for (const [key, value] of Object.entries(providerSettings)) {
          if (reservedKeys.has(key) || value === undefined || value === null) {
            continue;
          }
          params[key] = value;
        }
      }

      return Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.getLogger().debug(
        () =>
          `Failed to get OpenAI provider settings from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Internal implementation for chat completion using normalized options
   * Routes to appropriate implementation based on toolCallProcessingMode
   */
  private async *generateChatCompletionImpl(
    options: NormalizedGenerateChatOptions,
    toolFormatter: ToolFormatter,
    client: OpenAI,
    logger: DebugLogger,
  ): AsyncGenerator<IContent, void, unknown> {
    if (this.toolCallProcessingMode === 'legacy') {
      yield* this.generateLegacyChatCompletionImpl(
        options,
        toolFormatter,
        client,
        logger,
      );
    } else {
      yield* this.generatePipelineChatCompletionImpl(
        options,
        toolFormatter,
        client,
        logger,
      );
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Pipeline implementation for chat completion using optimized tool call pipeline
   */
  private async *generatePipelineChatCompletionImpl(
    options: NormalizedGenerateChatOptions,
    toolFormatter: ToolFormatter,
    client: OpenAI,
    logger: DebugLogger,
  ): AsyncGenerator<IContent, void, unknown> {
    const { contents, tools, metadata } = options;
    const model = options.resolved.model || this.getDefaultModel();
    const abortSignal = metadata?.abortSignal as AbortSignal | undefined;
    const ephemeralSettings = options.invocation?.ephemerals ?? {};

    if (logger.enabled) {
      const resolved = options.resolved;
      logger.debug(() => `[OpenAIProvider] Resolved request context`, {
        provider: this.name,
        model,
        resolvedModel: resolved.model,
        resolvedBaseUrl: resolved.baseURL,
        authTokenPresent: Boolean(resolved.authToken),
        messageCount: contents.length,
        toolCount: tools?.length ?? 0,
        metadataKeys: Object.keys(metadata ?? {}),
      });
    }

    // Detect the tool format to use BEFORE building messages
    // This is needed so that Kimi K2 tool IDs can be generated in the correct format
    const detectedFormat = this.detectToolFormat();

    // Log the detected format for debugging
    logger.debug(
      () =>
        `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
      {
        model,
        detectedFormat,
        provider: this.name,
      },
    );

    // Convert IContent to OpenAI messages format
    // Use buildMessagesWithReasoning for reasoning-aware message building
    // Pass detectedFormat so that Kimi K2 tool IDs are generated correctly
    const messages = this.buildMessagesWithReasoning(
      contents,
      options,
      detectedFormat,
    );

    // Convert Gemini format tools to OpenAI format using the schema converter
    // This ensures required fields are always present in tool schemas
    let formattedTools: OpenAITool[] | undefined = convertToolsToOpenAI(tools);

    // CRITICAL FIX: Ensure we never pass an empty tools array
    // The OpenAI API errors when tools=[] but a tool call is attempted
    if (Array.isArray(formattedTools) && formattedTools.length === 0) {
      logger.warn(
        () =>
          `[OpenAIProvider] CRITICAL: Formatted tools is empty array! Setting to undefined to prevent API errors.`,
        {
          model,
          inputTools: tools,
          inputToolsLength: tools?.length,
          inputFirstGroup: tools?.[0],
          stackTrace: new Error().stack,
        },
      );
      formattedTools = undefined;
    }

    // Debug log the conversion result - enhanced logging for intermittent issues
    if (logger.enabled && formattedTools) {
      logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
        detectedFormat,
        inputHadTools: !!tools,
        inputToolsLength: tools?.length,
        inputFirstGroup: tools?.[0],
        inputFunctionDeclarationsLength:
          tools?.[0]?.functionDeclarations?.length,
        outputHasTools: !!formattedTools,
        outputToolsLength: formattedTools?.length,
        outputToolNames: formattedTools?.map((t) => t.function.name),
      });
    }

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting = ephemeralSettings['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Get the system prompt
    const flattenedToolNames =
      tools?.flatMap((group) =>
        group.functionDeclarations
          .map((decl) => decl.name)
          .filter((name): name is string => !!name),
      ) ?? [];
    const toolNamesArg =
      tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-003
     * Source user memory from normalized options instead of global config
     */
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation?.userMemory,
    );
    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      model,
      toolNamesArg,
    );

    // Add system prompt as the first message in the array
    const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const maxTokens =
      (metadata?.maxTokens as number | undefined) ??
      (ephemeralSettings['max-tokens'] as number | undefined);

    // Build request - only include tools if they exist and are not empty
    // IMPORTANT: Create a deep copy of tools to prevent mutation issues
    const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messagesWithSystem,
      stream: streamingEnabled,
    };

    if (formattedTools && formattedTools.length > 0) {
      // Attach tool definitions; they are not mutated by compression logic
      requestBody.tools = formattedTools;
      requestBody.tool_choice = 'auto';
    }

    /**
     * @plan:PLAN-20251023-STATELESS-HARDENING.P08
     * @requirement:REQ-SP4-002
     * Extract per-call request overrides from normalized options instead of cached state
     */
    const requestOverrides = this.extractModelParamsFromOptions(options);
    if (requestOverrides) {
      if (logger.enabled) {
        logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
          overrideKeys: Object.keys(requestOverrides),
        });
      }
      Object.assign(requestBody, requestOverrides);
    }

    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
      requestBody.max_tokens = maxTokens;
    }

    // Debug log request summary for Cerebras/Qwen
    const baseURL = options.resolved.baseURL ?? this.getBaseURL();

    if (
      logger.enabled &&
      (model.toLowerCase().includes('qwen') || baseURL?.includes('cerebras'))
    ) {
      logger.debug(() => `Request to ${baseURL} for model ${model}:`, {
        baseURL,
        model,
        streamingEnabled,
        hasTools: 'tools' in requestBody,
        toolCount: formattedTools?.length || 0,
        messageCount: messages.length,
        toolsInRequest:
          'tools' in requestBody ? requestBody.tools?.length : 'not included',
      });
    }

    // Get retry settings from ephemeral settings
    const maxRetries =
      (ephemeralSettings['retries'] as number | undefined) ?? 6; // Default for OpenAI
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000; // Default for OpenAI

    // Get stream options from ephemeral settings (default: include usage for token tracking)
    const streamOptions = (ephemeralSettings['stream-options'] as
      | { include_usage?: boolean }
      | undefined) || { include_usage: true };

    // Add stream options to request if streaming is enabled
    if (streamingEnabled && streamOptions) {
      Object.assign(requestBody, { stream_options: streamOptions });
    }

    // Log the exact tools being sent for debugging
    if (logger.enabled && 'tools' in requestBody) {
      logger.debug(() => `[OpenAIProvider] Exact tools being sent to API:`, {
        toolCount: requestBody.tools?.length,
        toolNames: requestBody.tools?.map((t) =>
          'function' in t ? t.function?.name : undefined,
        ),
        firstTool: requestBody.tools?.[0],
      });
    }

    // Wrap the API call with retry logic using centralized retry utility
    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Sending chat request`, {
        model,
        baseURL: baseURL ?? this.getBaseURL(),
        streamingEnabled,
        toolCount: formattedTools?.length ?? 0,
        hasAuthToken: Boolean(options.resolved.authToken),
        requestHasSystemPrompt: Boolean(systemPrompt?.length),
        messageCount: messagesWithSystem.length,
      });
    }
    let response;

    // Debug log throttle tracker status
    logger.debug(() => `Retry configuration:`, {
      hasThrottleTracker: !!this.throttleTracker,
      throttleTrackerType: typeof this.throttleTracker,
      maxRetries,
      initialDelayMs,
    });

    const customHeaders = this.getCustomHeaders();

    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Request body preview`, {
        model: requestBody.model,
        hasStop: 'stop' in requestBody,
        hasMaxTokens: 'max_tokens' in requestBody,
        hasResponseFormat: 'response_format' in requestBody,
        overrideKeys: requestOverrides ? Object.keys(requestOverrides) : [],
      });
    }

    // Get dump mode from ephemeral settings
    const dumpMode = ephemeralSettings.dumpcontext as DumpMode | undefined;
    const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
    const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

    // Track failover client - only rebuilt after bucket failover succeeds
    // @plan PLAN-20251213issue686 Fix: client must be rebuilt after bucket failover
    let failoverClientTools: OpenAI | null = null;

    // Bucket failover callback for 429 errors - tools mode
    // @plan PLAN-20251213issue686 Bucket failover integration for OpenAIProvider
    const onPersistent429CallbackTools = async (): Promise<boolean | null> => {
      const { result, client } = await this.handleBucketFailoverOnPersistent429(
        options,
        logger,
      );
      if (client) {
        failoverClientTools = client;
      }
      return result;
    };

    if (streamingEnabled) {
      // Streaming mode - use retry loop with compression support
      let compressedOnce = false;
      while (true) {
        try {
          // Use failover client if bucket failover happened, otherwise use original client
          // @plan PLAN-20251213issue686 Fix: client must be rebuilt after bucket failover
          response = await retryWithBackoff(
            () => {
              const currentClient = failoverClientTools ?? client;
              return currentClient.chat.completions.create(requestBody, {
                ...(abortSignal ? { signal: abortSignal } : {}),
                ...(customHeaders ? { headers: customHeaders } : {}),
              });
            },
            {
              maxAttempts: maxRetries,
              initialDelayMs,
              shouldRetryOnError: this.shouldRetryResponse.bind(this),
              trackThrottleWaitTime: this.throttleTracker,
              onPersistent429: onPersistent429CallbackTools,
            },
          );

          // Dump successful streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              { streaming: true },
              false,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          break;
        } catch (error) {
          // Special handling for Cerebras/Qwen "Tool not present" errors
          const errorMessage = String(error);
          if (
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'))
          ) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            // Re-throw but with better context
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }

          // Tool message compression logic
          if (
            !compressedOnce &&
            this.shouldCompressToolMessages(error, logger) &&
            this.compressToolMessages(requestBody.messages, 512, logger)
          ) {
            compressedOnce = true;
            logger.warn(
              () =>
                `[OpenAIProvider] Retrying streaming request after compressing tool responses due to provider 400`,
            );
            continue;
          }

          // Dump error if enabled
          if (shouldDumpError) {
            const dumpErrorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              { error: dumpErrorMessage },
              true,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          // Re-throw other errors as-is
          const capturedErrorMessage =
            error instanceof Error ? error.message : String(error);
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status: unknown }).status === 'number'
              ? (error as { status: number }).status
              : undefined;

          logger.error(
            () =>
              `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? this.getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
            {
              model,
              baseURL: baseURL ?? this.getBaseURL(),
              streamingEnabled,
              hasTools: formattedTools?.length ?? 0,
              requestHasSystemPrompt: !!systemPrompt,
              status,
            },
          );
          throw error;
        }
      }
    } else {
      // Non-streaming mode - use comprehensive retry loop with compression
      let compressedOnce = false;
      while (true) {
        try {
          // Use failover client if bucket failover happened, otherwise use original client
          // @plan PLAN-20251213issue686 Fix: client must be rebuilt after bucket failover
          response = (await retryWithBackoff(
            () => {
              const currentClient = failoverClientTools ?? client;
              return currentClient.chat.completions.create(requestBody, {
                ...(abortSignal ? { signal: abortSignal } : {}),
                ...(customHeaders ? { headers: customHeaders } : {}),
              });
            },
            {
              maxAttempts: maxRetries,
              initialDelayMs,
              shouldRetryOnError: this.shouldRetryResponse.bind(this),
              trackThrottleWaitTime: this.throttleTracker,
              onPersistent429: onPersistent429CallbackTools,
            },
          )) as OpenAI.Chat.Completions.ChatCompletion;

          // Dump successful non-streaming request if enabled
          if (shouldDumpSuccess) {
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              response,
              false,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          break;
        } catch (error) {
          const errorMessage = String(error);
          logger.debug(() => `[OpenAIProvider] Chat request error`, {
            errorType: error?.constructor?.name,
            status:
              typeof error === 'object' && error && 'status' in error
                ? (error as { status?: number }).status
                : undefined,
            errorKeys:
              error && typeof error === 'object' ? Object.keys(error) : [],
          });

          const isCerebrasToolError =
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'));

          if (isCerebrasToolError) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }

          // Tool message compression logic
          if (
            !compressedOnce &&
            this.shouldCompressToolMessages(error, logger) &&
            this.compressToolMessages(requestBody.messages, 512, logger)
          ) {
            compressedOnce = true;
            logger.warn(
              () =>
                `[OpenAIProvider] Retrying request after compressing tool responses due to provider 400`,
            );
            continue;
          }

          // Dump error if enabled
          if (shouldDumpError) {
            const dumpErrorMessage =
              error instanceof Error ? error.message : String(error);
            await dumpSDKContext(
              'openai',
              '/chat/completions',
              requestBody,
              { error: dumpErrorMessage },
              true,
              baseURL || 'https://api.openai.com/v1',
            );
          }

          const capturedErrorMessage =
            error instanceof Error ? error.message : String(error);
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status: unknown }).status === 'number'
              ? (error as { status: number }).status
              : undefined;

          logger.error(
            () =>
              `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? this.getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
            {
              model,
              baseURL: baseURL ?? this.getBaseURL(),
              streamingEnabled,
              hasTools: formattedTools?.length ?? 0,
              requestHasSystemPrompt: !!systemPrompt,
              status,
            },
          );
          throw error;
        }
      }
    }

    // Check if response is streaming or not
    if (streamingEnabled) {
      // Process streaming response
      let _accumulatedText = '';

      // Initialize tool call pipeline for this streaming session
      this.toolCallPipeline.reset();

      // Buffer for accumulating text chunks for providers that need it
      let textBuffer = '';
      // Use the same detected format from earlier for consistency
      const isKimiK2Model = model.toLowerCase().includes('kimi-k2');
      // Buffer text for Qwen format providers and Kimi-K2 to avoid stanza formatting
      const shouldBufferText = detectedFormat === 'qwen' || isKimiK2Model;

      // Accumulate thinking content across the entire stream to emit as ONE block
      // This handles fragmented <think>word</think> streaming from Synthetic API
      // @plan PLAN-20251202-THINKING.P16
      let accumulatedThinkingContent = '';
      let hasEmittedThinking = false;

      // Accumulate reasoning_content from streaming deltas (pipeline path)
      // Synthetic API sends reasoning token-by-token, so we accumulate to emit ONE block
      // @plan PLAN-20251202-THINKING.P16
      let accumulatedReasoningContent = '';

      // Track token usage from streaming chunks
      let streamingUsage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | null = null;

      // Track finish_reason for detecting empty responses (issue #584)
      let lastFinishReason: string | null | undefined = null;

      // Store pipeline result to avoid duplicate process() calls (CodeRabbit review #764)
      let cachedPipelineResult: Awaited<
        ReturnType<typeof this.toolCallPipeline.process>
      > | null = null;

      const allChunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = []; // Collect all chunks first

      try {
        // Handle streaming response - collect all chunks
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          if (abortSignal?.aborted) {
            break;
          }
          allChunks.push(chunk);
        }

        // Debug: Log how many chunks were received
        logger.debug(
          () =>
            `[Streaming pipeline] Collected ${allChunks.length} chunks from stream`,
          {
            firstChunkDelta: allChunks[0]?.choices?.[0]?.delta,
            lastChunkFinishReason:
              allChunks[allChunks.length - 1]?.choices?.[0]?.finish_reason,
          },
        );

        // Now process all collected chunks
        for (const chunk of allChunks) {
          // Check for cancellation during chunk processing
          if (abortSignal?.aborted) {
            break;
          }
          const chunkRecord = chunk as unknown as Record<string, unknown>;
          let parsedData: Record<string, unknown> | undefined;
          const rawData = chunkRecord?.data;
          if (typeof rawData === 'string') {
            try {
              parsedData = JSON.parse(rawData) as Record<string, unknown>;
            } catch {
              parsedData = undefined;
            }
          } else if (rawData && typeof rawData === 'object') {
            parsedData = rawData as Record<string, unknown>;
          }

          const streamingError =
            chunkRecord?.error ??
            parsedData?.error ??
            (parsedData?.data as { error?: unknown } | undefined)?.error;
          const streamingEvent = (chunkRecord?.event ?? parsedData?.event) as
            | string
            | undefined;
          const streamingErrorMessage =
            (streamingError as { message?: string } | undefined)?.message ??
            (streamingError as { error?: string } | undefined)?.error ??
            (parsedData as { message?: string } | undefined)?.message;
          if (
            streamingEvent === 'error' ||
            (streamingError && typeof streamingError === 'object')
          ) {
            const errorMessage =
              streamingErrorMessage ??
              (typeof streamingError === 'string'
                ? streamingError
                : 'Streaming response reported an error.');
            throw new Error(errorMessage);
          }

          // Extract usage information if present (typically in final chunk)
          if (chunk.usage) {
            streamingUsage = chunk.usage;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Parse reasoning_content from streaming delta (Pipeline path)
          // ACCUMULATE instead of yielding immediately to handle token-by-token streaming
          // Extract embedded Kimi K2 tool calls from reasoning_content (fixes #749)
          // @plan PLAN-20251202-THINKING.P16
          // @requirement REQ-THINK-003.1, REQ-KIMI-REASONING-001.1
          const { thinking: reasoningBlock, toolCalls: reasoningToolCalls } =
            this.parseStreamingReasoningDelta(choice.delta);
          if (reasoningBlock) {
            // Accumulate reasoning content - will emit ONE block later
            accumulatedReasoningContent += reasoningBlock.thought;
          }
          // Add tool calls extracted from reasoning_content to pipeline
          if (reasoningToolCalls.length > 0) {
            // Get current pipeline stats to determine next index
            const stats = this.toolCallPipeline.getStats();
            let baseIndex = stats.collector.totalCalls;

            for (const toolCall of reasoningToolCalls) {
              // Add complete tool call as fragments to pipeline
              this.toolCallPipeline.addFragment(baseIndex, {
                name: toolCall.name,
                args: JSON.stringify(toolCall.parameters),
              });
              baseIndex++;
            }
          }

          // Check for finish_reason to detect proper stream ending
          if (choice.finish_reason) {
            lastFinishReason = choice.finish_reason;
            logger.debug(
              () =>
                `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
              {
                model,
                finishReason: choice.finish_reason,
                hasAccumulatedText: _accumulatedText.length > 0,
                hasAccumulatedTools:
                  this.toolCallPipeline.getStats().collector.totalCalls > 0,
                hasBufferedText: textBuffer.length > 0,
              },
            );

            // If finish_reason is 'length', the response was cut off
            if (choice.finish_reason === 'length') {
              logger.debug(
                () =>
                  `Response truncated due to length limit for model ${model}`,
              );
            }

            // Don't flush buffer here on finish - let the final buffer handling
            // after the loop process it with proper sanitization and think tag extraction
            // This was causing unsanitized <think> tags to leak into output (pipeline path)
            // @plan PLAN-20251202-THINKING.P16
          }

          // Handle text content - buffer for Qwen format, emit immediately for others
          // Note: Synthetic API sends content that may duplicate reasoning_content.
          // This is the model's behavior - we don't filter it here as detection is unreliable.
          // @plan PLAN-20251202-THINKING.P16
          const rawDeltaContent = this.coerceMessageContentToString(
            choice.delta?.content as unknown,
          );
          if (rawDeltaContent) {
            // For Kimi models, we need to buffer the RAW content without processing
            // because Kimi tokens stream incrementally and partial tokens would leak
            // through if we try to process them immediately. The buffer will be
            // processed when flushed (at sentence boundaries or end of stream).
            let deltaContent: string;
            if (isKimiK2Model) {
              // For Kimi: Don't process yet - just pass through and let buffering handle it
              // We'll extract tool calls and sanitize when we flush the buffer
              deltaContent = rawDeltaContent;
            } else {
              // For non-Kimi models: sanitize immediately as before
              deltaContent = this.sanitizeProviderText(rawDeltaContent);
            }
            if (!deltaContent) {
              continue;
            }

            _accumulatedText += deltaContent;

            // Debug log for providers that need buffering
            if (shouldBufferText) {
              logger.debug(
                () => `[Streaming] Chunk content for ${detectedFormat} format:`,
                {
                  deltaContent,
                  length: deltaContent.length,
                  hasNewline: deltaContent.includes('\n'),
                  escaped: JSON.stringify(deltaContent),
                  bufferSize: textBuffer.length,
                },
              );

              // Buffer text to avoid stanza formatting
              textBuffer += deltaContent;

              const kimiBeginCount = (
                textBuffer.match(/<\|tool_calls_section_begin\|>/g) || []
              ).length;
              const kimiEndCount = (
                textBuffer.match(/<\|tool_calls_section_end\|>/g) || []
              ).length;
              const hasOpenKimiSection = kimiBeginCount > kimiEndCount;

              // Emit buffered text when we have a complete sentence or paragraph
              // Look for natural break points, avoiding flush mid Kimi section
              if (
                !hasOpenKimiSection &&
                (textBuffer.includes('\n') ||
                  textBuffer.endsWith('. ') ||
                  textBuffer.endsWith('! ') ||
                  textBuffer.endsWith('? ') ||
                  textBuffer.length > 100)
              ) {
                const parsedToolCalls: ToolCallBlock[] = [];
                let workingText = textBuffer;

                // Extract <think> tags and ACCUMULATE instead of emitting immediately
                // This handles fragmented <think>word</think> streaming from Synthetic API
                // @plan PLAN-20251202-THINKING.P16
                // @requirement REQ-THINK-003
                const tagBasedThinking =
                  this.extractThinkTagsAsBlock(workingText);
                if (tagBasedThinking) {
                  // Clean Kimi tokens from thinking content before accumulating
                  const cleanedThought = this.cleanThinkingContent(
                    tagBasedThinking.thought,
                  );
                  // Accumulate thinking content - don't emit yet
                  // Use newline to preserve formatting between chunks (not space)
                  if (accumulatedThinkingContent.length > 0) {
                    accumulatedThinkingContent += '\n';
                  }
                  accumulatedThinkingContent += cleanedThought;
                  logger.debug(
                    () =>
                      `[Streaming] Accumulated thinking: ${accumulatedThinkingContent.length} chars total`,
                  );
                }

                const kimiParsed =
                  this.extractKimiToolCallsFromText(workingText);
                if (kimiParsed.toolCalls.length > 0) {
                  parsedToolCalls.push(...kimiParsed.toolCalls);
                  logger.debug(
                    () =>
                      `[OpenAIProvider] Streaming buffer (pipeline) parsed Kimi tool calls`,
                    {
                      count: kimiParsed.toolCalls.length,
                      bufferLength: workingText.length,
                      cleanedLength: kimiParsed.cleanedText.length,
                    },
                  );
                }
                workingText = kimiParsed.cleanedText;

                const parsingText = this.sanitizeProviderText(workingText);
                let cleanedText = parsingText;
                try {
                  const parsedResult = this.textToolParser.parse(parsingText);
                  if (parsedResult.toolCalls.length > 0) {
                    parsedToolCalls.push(
                      ...parsedResult.toolCalls.map((call) => ({
                        type: 'tool_call' as const,
                        id: `text_tool_${Date.now()}_${Math.random()
                          .toString(36)
                          .substring(7)}`,
                        name: this.normalizeToolName(call.name),
                        parameters: call.arguments,
                      })),
                    );
                    cleanedText = parsedResult.cleanedContent;
                  }
                } catch (error) {
                  const logger = this.getLogger();
                  logger.debug(
                    () =>
                      `TextToolCallParser failed on buffered text: ${error}`,
                  );
                }

                // Emit accumulated thinking BEFORE tool calls or text content
                // This ensures thinking appears first in the response
                // @plan PLAN-20251202-THINKING.P16
                if (
                  !hasEmittedThinking &&
                  accumulatedThinkingContent.length > 0 &&
                  (parsedToolCalls.length > 0 || cleanedText.trim().length > 0)
                ) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: accumulatedThinkingContent,
                        sourceField: 'think_tags',
                        isHidden: false,
                      } as ThinkingBlock,
                    ],
                  } as IContent;
                  hasEmittedThinking = true;
                  logger.debug(
                    () =>
                      `[Streaming pipeline] Emitted accumulated thinking: ${accumulatedThinkingContent.length} chars`,
                  );
                }

                if (parsedToolCalls.length > 0) {
                  yield {
                    speaker: 'ai',
                    blocks: parsedToolCalls,
                  } as IContent;
                }

                // Always use sanitized text to strip <think> tags (pipeline streaming)
                // Bug fix: Previously Kimi used unsanitized workingText
                // @plan PLAN-20251202-THINKING.P16
                // Bug fix #721: Emit whitespace-only chunks (e.g., " " between words)
                // Previously we used cleanedText.trim().length > 0 which dropped spaces,
                // causing "list 5" to become "list5". Now we emit any non-empty cleanedText.
                if (cleanedText.length > 0) {
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'text',
                        text: cleanedText,
                      } as TextBlock,
                    ],
                  } as IContent;
                }

                textBuffer = '';
              }
            } else {
              // For other providers, emit text immediately as before
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: deltaContent,
                  } as TextBlock,
                ],
              } as IContent;
            }
          }

          // Handle tool calls using the new pipeline
          const deltaToolCalls = choice.delta?.tool_calls;
          if (deltaToolCalls && deltaToolCalls.length > 0) {
            for (const deltaToolCall of deltaToolCalls) {
              if (deltaToolCall.index === undefined) continue;

              // Add fragment to pipeline instead of accumulating strings
              this.toolCallPipeline.addFragment(deltaToolCall.index, {
                name: deltaToolCall.function?.name,
                args: deltaToolCall.function?.arguments,
              });
            }
          }

          const choiceMessage = (
            choice as {
              message?: {
                tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
              };
            }
          ).message;
          const messageToolCalls = choiceMessage?.tool_calls;
          if (messageToolCalls && messageToolCalls.length > 0) {
            messageToolCalls.forEach(
              (
                toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
                index: number,
              ) => {
                if (!toolCall || toolCall.type !== 'function') {
                  return;
                }

                // Add final complete tool call to pipeline
                this.toolCallPipeline.addFragment(index, {
                  name: toolCall.function?.name,
                  args: toolCall.function?.arguments,
                });
              },
            );
          }
        }
      } catch (error) {
        if (
          abortSignal?.aborted ||
          (error &&
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'AbortError')
        ) {
          // Signal was aborted - treat as intentional cancellation
          logger.debug(
            () =>
              `Pipeline streaming response cancelled by AbortSignal (error: ${error instanceof Error ? error.name : 'unknown'})`,
          );
          throw error;
        } else {
          // Special handling for Cerebras/Qwen "Tool not present" errors
          const errorMessage = String(error);
          if (
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'))
          ) {
            logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
                streamingEnabled,
              },
            );
            // Re-throw but with better context
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list during streaming. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }
          logger.error('Error processing streaming response:', error);
          throw error;
        }
      }

      // Check buffered text for <tool_call> format before flushing as plain text
      if (textBuffer.length > 0) {
        const parsedToolCalls: ToolCallBlock[] = [];
        let workingText = textBuffer;

        // Note: Synthetic API sends reasoning via both reasoning_content AND content fields.
        // This is the model's behavior - we don't strip it since the model is the source.
        // The user can configure reasoning display settings if they don't want duplicates.
        // @plan PLAN-20251202-THINKING.P16

        // Extract any remaining <think> tags from final buffer
        // @plan PLAN-20251202-THINKING.P16
        const tagBasedThinking = this.extractThinkTagsAsBlock(workingText);
        if (tagBasedThinking) {
          // Clean Kimi tokens from thinking content before accumulating
          const cleanedThought = this.cleanThinkingContent(
            tagBasedThinking.thought,
          );
          // Use newline to preserve formatting between chunks (not space)
          if (accumulatedThinkingContent.length > 0) {
            accumulatedThinkingContent += '\n';
          }
          accumulatedThinkingContent += cleanedThought;
        }

        const kimiParsed = this.extractKimiToolCallsFromText(workingText);
        if (kimiParsed.toolCalls.length > 0) {
          parsedToolCalls.push(...kimiParsed.toolCalls);
          this.getLogger().debug(
            () =>
              `[OpenAIProvider] Final buffer flush (pipeline) parsed Kimi tool calls`,
            {
              count: kimiParsed.toolCalls.length,
              bufferLength: workingText.length,
              cleanedLength: kimiParsed.cleanedText.length,
            },
          );
        }
        workingText = kimiParsed.cleanedText;

        const parsingText = this.sanitizeProviderText(workingText);
        let cleanedText = parsingText;
        try {
          const parsedResult = this.textToolParser.parse(parsingText);
          if (parsedResult.toolCalls.length > 0) {
            parsedToolCalls.push(
              ...parsedResult.toolCalls.map((call) => ({
                type: 'tool_call' as const,
                id: `text_tool_${Date.now()}_${Math.random()
                  .toString(36)
                  .substring(7)}`,
                name: this.normalizeToolName(call.name),
                parameters: call.arguments,
              })),
            );
            cleanedText = parsedResult.cleanedContent;
          }
        } catch (error) {
          const logger = this.getLogger();
          logger.debug(
            () => `TextToolCallParser failed on buffered text: ${error}`,
          );
        }

        // Emit accumulated thinking BEFORE tool calls or text content
        // @plan PLAN-20251202-THINKING.P16
        if (
          !hasEmittedThinking &&
          accumulatedThinkingContent.length > 0 &&
          (parsedToolCalls.length > 0 || cleanedText.trim().length > 0)
        ) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: accumulatedThinkingContent,
                sourceField: 'think_tags',
                isHidden: false,
              } as ThinkingBlock,
            ],
          } as IContent;
          hasEmittedThinking = true;
        }

        if (parsedToolCalls.length > 0) {
          yield {
            speaker: 'ai',
            blocks: parsedToolCalls,
          } as IContent;
        }

        // Always use sanitized text to strip <think> tags (pipeline final buffer)
        // Bug fix: Previously Kimi used unsanitized workingText
        // @plan PLAN-20251202-THINKING.P16
        // Bug fix #721: Emit whitespace-only chunks (e.g., " " between words)
        // Previously we used cleanedText.trim().length > 0 which dropped spaces,
        // causing "list 5" to become "list5". Now we emit any non-empty cleanedText.
        if (cleanedText.length > 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: cleanedText,
              } as TextBlock,
            ],
          } as IContent;
        }

        textBuffer = '';
      }

      // Emit any remaining accumulated thinking that wasn't emitted yet
      // (e.g., if entire response was just thinking with no content)
      // @plan PLAN-20251202-THINKING.P16
      if (!hasEmittedThinking && accumulatedThinkingContent.length > 0) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: accumulatedThinkingContent,
              sourceField: 'think_tags',
              isHidden: false,
            } as ThinkingBlock,
          ],
        } as IContent;
        hasEmittedThinking = true;
      }

      // Emit accumulated reasoning_content as ONE ThinkingBlock (pipeline path)
      // This consolidates token-by-token reasoning from Synthetic API into a single block
      // Clean Kimi tokens from the accumulated content (not per-chunk) to handle split tokens
      // @plan PLAN-20251202-THINKING.P16
      if (accumulatedReasoningContent.length > 0) {
        // Extract Kimi tool calls from the complete accumulated reasoning content
        const { cleanedText: cleanedReasoning, toolCalls: reasoningToolCalls } =
          this.extractKimiToolCallsFromText(accumulatedReasoningContent);

        // Emit the cleaned thinking block
        if (cleanedReasoning.length > 0) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: cleanedReasoning,
                sourceField: 'reasoning_content',
                isHidden: false,
              } as ThinkingBlock,
            ],
          } as IContent;
        }

        // Emit any tool calls extracted from reasoning content
        if (reasoningToolCalls.length > 0) {
          yield {
            speaker: 'ai',
            blocks: reasoningToolCalls,
          } as IContent;
        }
      }

      // Process and emit tool calls using the pipeline
      cachedPipelineResult = await this.toolCallPipeline.process(abortSignal);
      if (
        cachedPipelineResult.normalized.length > 0 ||
        cachedPipelineResult.failed.length > 0
      ) {
        const blocks: ToolCallBlock[] = [];

        // Process successful tool calls
        for (const normalizedCall of cachedPipelineResult.normalized) {
          const sanitizedArgs = this.sanitizeToolArgumentsString(
            normalizedCall.originalArgs ?? normalizedCall.args,
          );

          // Process tool parameters with double-escape handling
          const processedParameters = processToolParameters(
            sanitizedArgs,
            normalizedCall.name,
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(`call_${normalizedCall.index}`),
            name: normalizedCall.name,
            parameters: processedParameters,
          });
        }

        // Handle failed tool calls (could emit as errors or warnings)
        for (const failed of cachedPipelineResult.failed) {
          this.getLogger().warn(
            `Tool call validation failed for index ${failed.index}: ${failed.validationErrors.join(', ')}`,
          );
        }

        if (blocks.length > 0) {
          const toolCallsContent: IContent = {
            speaker: 'ai',
            blocks,
          };

          // Add usage metadata if we captured it from streaming
          if (streamingUsage) {
            const cacheMetrics = extractCacheMetrics(streamingUsage);
            toolCallsContent.metadata = {
              usage: {
                promptTokens: streamingUsage.prompt_tokens || 0,
                completionTokens: streamingUsage.completion_tokens || 0,
                totalTokens:
                  streamingUsage.total_tokens ||
                  (streamingUsage.prompt_tokens || 0) +
                    (streamingUsage.completion_tokens || 0),
                cachedTokens: cacheMetrics.cachedTokens,
                cacheCreationTokens: cacheMetrics.cacheCreationTokens,
                cacheMissTokens: cacheMetrics.cacheMissTokens,
              },
            };
          }

          yield toolCallsContent;
        }
      }

      // If we have usage information but no tool calls, emit a metadata-only response
      if (
        streamingUsage &&
        this.toolCallPipeline.getStats().collector.totalCalls === 0
      ) {
        const cacheMetrics = extractCacheMetrics(streamingUsage);
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: streamingUsage.prompt_tokens || 0,
              completionTokens: streamingUsage.completion_tokens || 0,
              totalTokens:
                streamingUsage.total_tokens ||
                (streamingUsage.prompt_tokens || 0) +
                  (streamingUsage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          },
        } as IContent;
      }

      // Detect and handle empty streaming responses after tool calls (issue #584)
      // Some models (like gpt-oss-120b on OpenRouter) return finish_reason=stop with tools but no text
      // Use cachedPipelineResult instead of pipelineStats.collector.totalCalls since process() resets the collector (CodeRabbit review #764)
      const toolCallCount =
        (cachedPipelineResult?.normalized.length ?? 0) +
        (cachedPipelineResult?.failed.length ?? 0);
      const hasToolsButNoText =
        lastFinishReason === 'stop' &&
        toolCallCount > 0 &&
        _accumulatedText.length === 0 &&
        textBuffer.length === 0 &&
        accumulatedReasoningContent.length === 0 &&
        accumulatedThinkingContent.length === 0;

      if (hasToolsButNoText) {
        logger.log(
          () =>
            `[OpenAIProvider] Model returned tool calls but no text (finish_reason=stop). Requesting continuation for model '${model}'.`,
          {
            model,
            toolCallCount,
            baseURL: baseURL ?? this.getBaseURL(),
          },
        );

        // Note: In pipeline mode, tool calls have already been processed.
        // We need to get the normalized tool calls from the cached pipeline result to build continuation messages.
        // Use cached result to avoid duplicate process() call that would return empty results (CodeRabbit review #764)
        if (!cachedPipelineResult) {
          throw new Error(
            'Pipeline result not cached - this should not happen in pipeline mode',
          );
        }
        const toolCallsForHistory = cachedPipelineResult.normalized.map(
          (normalizedCall, index) => ({
            id: `call_${index}`,
            type: 'function' as const,
            function: {
              name: normalizedCall.name,
              arguments: JSON.stringify(normalizedCall.args),
            },
          }),
        );

        // Request continuation after tool calls (delegated to shared method)
        yield* this.requestContinuationAfterToolCalls(
          toolCallsForHistory,
          messagesWithSystem,
          requestBody,
          client,
          abortSignal,
          model,
          logger,
          customHeaders,
        );
      }

      // Detect and warn about empty streaming responses (common with Kimi K2 after tool calls)
      // Only warn if we truly got nothing - not even reasoning content
      if (
        _accumulatedText.length === 0 &&
        toolCallCount === 0 &&
        textBuffer.length === 0 &&
        accumulatedReasoningContent.length === 0 &&
        accumulatedThinkingContent.length === 0
      ) {
        // Provide actionable guidance for users
        const isKimi = model.toLowerCase().includes('kimi');
        const isSynthetic =
          (baseURL ?? this.getBaseURL())?.includes('synthetic') ?? false;
        const troubleshooting = isKimi
          ? isSynthetic
            ? ' To fix: use streaming: "disabled" in your profile settings. Synthetic API streaming does not work reliably with tool calls.'
            : ' This provider may not support streaming with tool calls.'
          : ' Consider using streaming: "disabled" in your profile settings.';

        logger.warn(
          () =>
            `[OpenAIProvider] Empty streaming response for model '${model}' (received ${allChunks.length} chunks with no content).${troubleshooting}`,
          {
            model,
            baseURL: baseURL ?? this.getBaseURL(),
            isKimiModel: isKimi,
            isSyntheticAPI: isSynthetic,
            totalChunksReceived: allChunks.length,
          },
        );
      } else {
        // Log what we DID get for debugging
        logger.debug(
          () =>
            `[Streaming pipeline] Stream completed with accumulated content`,
          {
            textLength: _accumulatedText.length,
            toolCallCount,
            textBufferLength: textBuffer.length,
            reasoningLength: accumulatedReasoningContent.length,
            thinkingLength: accumulatedThinkingContent.length,
            totalChunksReceived: allChunks.length,
          },
        );
      }
    } else {
      // Handle non-streaming response
      const completion = response as OpenAI.Chat.Completions.ChatCompletion;
      const choice = completion.choices?.[0];

      if (!choice) {
        throw new Error('No choices in completion response');
      }

      // Log finish reason for debugging Qwen issues
      if (choice.finish_reason) {
        logger.debug(
          () =>
            `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
          {
            model,
            finishReason: choice.finish_reason,
            hasContent: !!choice.message?.content,
            hasToolCalls: !!(
              choice.message?.tool_calls && choice.message.tool_calls.length > 0
            ),
            contentLength: choice.message?.content?.length || 0,
            toolCallCount: choice.message?.tool_calls?.length || 0,
            detectedFormat,
          },
        );

        // Warn if the response was truncated
        if (choice.finish_reason === 'length') {
          logger.warn(
            () =>
              `Response truncated due to max_tokens limit for model ${model}. Consider increasing max_tokens.`,
          );
        }
      }

      const blocks: Array<TextBlock | ToolCallBlock> = [];

      // Handle text content (strip thinking / reasoning blocks) and Kimi tool sections
      const pipelineRawMessageContent = this.coerceMessageContentToString(
        choice.message?.content as unknown,
      );
      let pipelineKimiCleanContent: string | undefined;
      let pipelineKimiToolBlocks: ToolCallBlock[] = [];
      if (pipelineRawMessageContent) {
        const kimiParsed = this.extractKimiToolCallsFromText(
          pipelineRawMessageContent,
        );
        pipelineKimiCleanContent = kimiParsed.cleanedText;
        pipelineKimiToolBlocks = kimiParsed.toolCalls;

        // Always use sanitized text - even Kimi-K2 should have consistent tag stripping
        const cleanedText = this.sanitizeProviderText(pipelineKimiCleanContent);
        if (cleanedText) {
          blocks.push({
            type: 'text',
            text: cleanedText,
          } as TextBlock);
        }
      }

      // Handle tool calls
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        // Use the same detected format from earlier for consistency

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === 'function') {
            // Normalize tool name for consistency with streaming path
            const normalizedName = this.toolCallPipeline.normalizeToolName(
              toolCall.function.name,
              toolCall.function.arguments,
            );

            const sanitizedArgs = this.sanitizeToolArgumentsString(
              toolCall.function.arguments,
            );

            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              sanitizedArgs,
              normalizedName,
            );

            blocks.push({
              type: 'tool_call',
              id: this.normalizeToHistoryToolId(toolCall.id),
              name: normalizedName,
              parameters: processedParameters,
            } as ToolCallBlock);
          }
        }
      }

      if (pipelineKimiToolBlocks.length > 0) {
        blocks.push(...pipelineKimiToolBlocks);
        this.getLogger().debug(
          () =>
            `[OpenAIProvider] Non-stream pipeline added Kimi tool calls from text`,
          { count: pipelineKimiToolBlocks.length },
        );
      }

      // Additionally check for <tool_call> format in text content
      if (pipelineKimiCleanContent) {
        const cleanedSource = this.sanitizeProviderText(
          pipelineKimiCleanContent,
        );
        if (cleanedSource) {
          try {
            const parsedResult = this.textToolParser.parse(cleanedSource);
            if (parsedResult.toolCalls.length > 0) {
              // Add tool calls found in text content
              for (const call of parsedResult.toolCalls) {
                blocks.push({
                  type: 'tool_call',
                  id: `text_tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  name: this.normalizeToolName(call.name),
                  parameters: call.arguments,
                } as ToolCallBlock);
              }

              // Update the text content to remove the tool call parts
              if (choice.message.content !== parsedResult.cleanedContent) {
                // Find the text block and update it
                const textBlockIndex = blocks.findIndex(
                  (block) => block.type === 'text',
                );
                if (textBlockIndex >= 0) {
                  (blocks[textBlockIndex] as TextBlock).text =
                    parsedResult.cleanedContent;
                } else if (parsedResult.cleanedContent.trim()) {
                  // Add cleaned text if it doesn't exist
                  blocks.unshift({
                    type: 'text',
                    text: parsedResult.cleanedContent,
                  } as TextBlock);
                }
              }
            }
          } catch (error) {
            const logger = this.getLogger();
            logger.debug(
              () => `TextToolCallParser failed on message content: ${error}`,
            );
          }
        }
      }

      // Emit the complete response as a single IContent
      if (blocks.length > 0) {
        const responseContent: IContent = {
          speaker: 'ai',
          blocks,
        };

        // Add usage metadata from non-streaming response
        if (completion.usage) {
          const cacheMetrics = extractCacheMetrics(completion.usage);
          responseContent.metadata = {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          };
        }

        yield responseContent;
      } else if (completion.usage) {
        // Emit metadata-only response if no content blocks but have usage info
        const cacheMetrics = extractCacheMetrics(completion.usage);
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
              cachedTokens: cacheMetrics.cachedTokens,
              cacheCreationTokens: cacheMetrics.cacheCreationTokens,
              cacheMissTokens: cacheMetrics.cacheMissTokens,
            },
          },
        } as IContent;
      }
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Legacy implementation for chat completion using accumulated tool calls approach
   */
  override getToolFormat(): string {
    const format = this.detectToolFormat();
    const logger = new DebugLogger('llxprt:provider:openai');
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  /**
   * Detects the tool call format based on the model being used
   * @returns The detected tool format ('openai', 'qwen', or 'kimi')
   */
  private detectToolFormat(): ToolFormat {
    // Auto-detect based on model name if set to 'auto' or not set
    const modelName = this.getModel() || this.getDefaultModel();
    const logger = new DebugLogger('llxprt:provider:openai');

    // Check for Kimi K2 models (requires special ID format: functions.{name}:{index})
    if (isKimiModel(modelName)) {
      logger.debug(
        () => `Auto-detected 'kimi' format for K2 model: ${modelName}`,
      );
      return 'kimi';
    }

    // Check for Mistral models (requires 9-char alphanumeric IDs)
    // This applies to both hosted API and self-hosted Mistral models
    if (isMistralModel(modelName)) {
      logger.debug(
        () => `Auto-detected 'mistral' format for Mistral model: ${modelName}`,
      );
      return 'mistral';
    }

    const lowerModelName = modelName.toLowerCase();

    // Check for GLM-4 models (glm-4, glm-4.5, glm-4.6, glm-4-5, etc.)
    if (lowerModelName.includes('glm-4')) {
      logger.debug(
        () => `Auto-detected 'qwen' format for GLM-4.x model: ${modelName}`,
      );
      return 'qwen';
    }

    // Check for qwen models
    if (lowerModelName.includes('qwen')) {
      logger.debug(
        () => `Auto-detected 'qwen' format for Qwen model: ${modelName}`,
      );
      return 'qwen';
    }

    // Default to 'openai' format
    logger.debug(() => `Using default 'openai' format for model: ${modelName}`);
    return 'openai';
  }

  /**
   * Parse tool response from API (placeholder for future response parsing)
   * @param response The raw API response
   * @returns Parsed tool response
   */
  parseToolResponse(response: unknown): unknown {
    // TODO: Implement response parsing based on detected format
    // For now, return the response as-is
    return response;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Determines whether a response should be retried based on error codes
   * @param error The error object from the API response
   * @returns true if the request should be retried, false otherwise
   */
  shouldRetryResponse(error: unknown): boolean {
    const logger = new DebugLogger('llxprt:provider:openai');

    // Don't retry if we're streaming chunks - just continue processing
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 200
    ) {
      return false;
    }

    // Check OpenAI SDK v5 error structure
    let status: number | undefined;

    // OpenAI SDK v5 error structure
    if (error && typeof error === 'object' && 'status' in error) {
      status = (error as { status?: number }).status;
    }

    // Also check error.response?.status for axios-style errors
    if (!status && error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number } }).response;
      if (response && typeof response === 'object' && 'status' in response) {
        status = response.status;
      }
    }

    // Also check error message for 429
    if (!status && error instanceof Error) {
      if (error.message.includes('429')) {
        status = 429;
      }
    }

    // Log what we're seeing
    logger.debug(() => `shouldRetryResponse checking error:`, {
      hasError: !!error,
      errorType: error?.constructor?.name,
      status,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
      errorData:
        error && typeof error === 'object' && 'error' in error
          ? (error as { error?: unknown }).error
          : undefined,
    });

    // Retry on 429 rate limit errors or 5xx server errors
    const shouldRetry = Boolean(
      status === 429 || status === 503 || status === 504,
    );

    if (shouldRetry) {
      logger.debug(() => `Will retry request due to status ${status}`);
    }

    return shouldRetry;
  }

  /**
   * Parse reasoning_content from streaming delta.
   *
   * @plan PLAN-20251202-THINKING.P11, PLAN-20251202-THINKING.P16
   * @requirement REQ-THINK-003.1, REQ-THINK-003.3, REQ-THINK-003.4, REQ-KIMI-REASONING-001.1
   * @issue #749
   */
  private parseStreamingReasoningDelta(
    delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
  ): { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] } {
    if (!delta) {
      return { thinking: null, toolCalls: [] };
    }

    // Access reasoning_content via type assertion since OpenAI SDK doesn't declare it
    const reasoningContent = (delta as unknown as Record<string, unknown>)
      .reasoning_content;

    // Handle absent, null, or non-string
    if (!reasoningContent || typeof reasoningContent !== 'string') {
      return { thinking: null, toolCalls: [] };
    }

    // Handle empty string only - preserve whitespace-only content (spaces, tabs)
    // to maintain proper formatting in accumulated reasoning (fixes issue #721)
    if (reasoningContent.length === 0) {
      return { thinking: null, toolCalls: [] };
    }

    // Extract Kimi K2 tool calls embedded in reasoning_content (fixes issue #749)
    const { cleanedText, toolCalls } =
      this.extractKimiToolCallsFromText(reasoningContent);

    // For streaming, preserve whitespace-only content for proper formatting (issue #721)
    // Only return null if the cleaned text is empty (length 0)
    const thinkingBlock =
      cleanedText.length === 0
        ? null
        : {
            type: 'thinking' as const,
            thought: cleanedText,
            sourceField: 'reasoning_content' as const,
            isHidden: false,
          };

    return { thinking: thinkingBlock, toolCalls };
  }

  /**
   * Parse reasoning_content from non-streaming message.
   *
   * @plan PLAN-20251202-THINKING.P11, PLAN-20251202-THINKING.P16
   * @requirement REQ-THINK-003.2, REQ-THINK-003.3, REQ-THINK-003.4, REQ-KIMI-REASONING-001.2
   * @issue #749
   */
  private parseNonStreamingReasoning(
    message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined,
  ): { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] } {
    if (!message) {
      return { thinking: null, toolCalls: [] };
    }

    // Access reasoning_content via type assertion since OpenAI SDK doesn't declare it
    const reasoningContent = (message as unknown as Record<string, unknown>)
      .reasoning_content;

    // Handle absent, null, or non-string
    if (!reasoningContent || typeof reasoningContent !== 'string') {
      return { thinking: null, toolCalls: [] };
    }

    // Handle empty string or whitespace-only - for non-streaming complete responses,
    // whitespace-only reasoning is unusual and should be treated as no reasoning
    if (reasoningContent.trim().length === 0) {
      return { thinking: null, toolCalls: [] };
    }

    // Extract Kimi K2 tool calls embedded in reasoning_content (fixes issue #749)
    const { cleanedText, toolCalls } =
      this.extractKimiToolCallsFromText(reasoningContent);

    // For non-streaming, trim whitespace after extraction
    const trimmedText = cleanedText.trim();
    const thinkingBlock =
      trimmedText.length === 0
        ? null
        : {
            type: 'thinking' as const,
            thought: trimmedText,
            sourceField: 'reasoning_content' as const,
            isHidden: false,
          };

    return { thinking: thinkingBlock, toolCalls };
  }

  /**
   * Request continuation after tool calls when model returned no text.
   * This is a helper to avoid code duplication between legacy and pipeline paths.
   *
   * @plan PLAN-20250120-DEBUGLOGGING.P15
   * @issue #584, #764 (CodeRabbit review)
   */
  private async *requestContinuationAfterToolCalls(
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>,
    messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    requestBody: OpenAI.Chat.ChatCompletionCreateParams,
    client: OpenAI,
    abortSignal: AbortSignal | undefined,
    model: string,
    logger: DebugLogger,
    customHeaders: Record<string, string> | undefined,
  ): AsyncGenerator<IContent, void, unknown> {
    // Build continuation messages
    const continuationMessages = [
      ...messagesWithSystem,
      // Add the assistant's tool calls
      {
        role: 'assistant' as const,
        tool_calls: toolCalls,
      },
      // Add placeholder tool responses (tools have NOT been executed yet - only acknowledged)
      ...toolCalls.map((tc) => ({
        role: 'tool' as const,
        tool_call_id: tc.id,
        content: '[Tool call acknowledged - awaiting execution]',
      })),
      // Add continuation prompt
      {
        role: 'user' as const,
        content:
          'The tool calls above have been registered. Please continue with your response.',
      },
    ];

    // Make a continuation request (wrap in try-catch since tools were already yielded)
    try {
      const continuationResponse = await client.chat.completions.create(
        {
          ...requestBody,
          messages: continuationMessages,
          stream: true, // Always stream for consistency
        },
        {
          ...(abortSignal ? { signal: abortSignal } : {}),
          ...(customHeaders ? { headers: customHeaders } : {}),
        },
      );

      let accumulatedText = '';

      // Process the continuation response
      for await (const chunk of continuationResponse as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (abortSignal?.aborted) {
          break;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const deltaContent = this.coerceMessageContentToString(
          choice.delta?.content as unknown,
        );
        if (deltaContent) {
          const sanitized = this.sanitizeProviderText(deltaContent);
          if (sanitized) {
            accumulatedText += sanitized;
            yield {
              speaker: 'ai',
              blocks: [
                {
                  type: 'text',
                  text: sanitized,
                } as TextBlock,
              ],
            } as IContent;
          }
        }
      }

      logger.debug(
        () =>
          `[OpenAIProvider] Continuation request completed, received ${accumulatedText.length} chars`,
        {
          model,
          accumulatedTextLength: accumulatedText.length,
        },
      );
    } catch (continuationError) {
      // Tool calls were already successfully yielded, so log warning and continue
      logger.warn(
        () =>
          `[OpenAIProvider] Continuation request failed, but tool calls were already emitted: ${continuationError instanceof Error ? continuationError.message : String(continuationError)}`,
        {
          model,
          error: continuationError,
        },
      );
      // Don't re-throw - tool calls were already successful
    }
  }
}
