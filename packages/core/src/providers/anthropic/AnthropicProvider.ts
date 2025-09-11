import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import { OAuthManager } from '../../auth/precedence.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';
import {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  TextBlock,
} from '../../services/history/IContent.js';
import {
  processToolParameters,
  logDoubleEscapingInChunk,
} from '../../tools/doubleEscapeUtils.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';

export class AnthropicProvider extends BaseProvider {
  private logger: DebugLogger;
  private anthropic: Anthropic;
  private toolFormatter: ToolFormatter;
  toolFormat: ToolFormat = 'anthropic';
  private _cachedAuthKey?: string; // Track cached auth key for client recreation

  // Model patterns for max output tokens
  private modelTokenPatterns: Array<{ pattern: RegExp; tokens: number }> = [
    { pattern: /claude-.*opus-4/i, tokens: 32000 },
    { pattern: /claude-.*sonnet-4/i, tokens: 64000 },
    { pattern: /claude-.*haiku-4/i, tokens: 200000 }, // Future-proofing for Haiku 4
    { pattern: /claude-.*3-7.*sonnet/i, tokens: 64000 },
    { pattern: /claude-.*3-5.*sonnet/i, tokens: 8192 },
    { pattern: /claude-.*3-5.*haiku/i, tokens: 8192 },
    { pattern: /claude-.*3.*opus/i, tokens: 4096 },
    { pattern: /claude-.*3.*haiku/i, tokens: 4096 },
  ];

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Initialize base provider with auth configuration
    const baseConfig: BaseProviderConfig = {
      name: 'anthropic',
      apiKey,
      baseURL,
      envKeyNames: ['ANTHROPIC_API_KEY'],
      isOAuthEnabled: !!oauthManager,
      oauthProvider: oauthManager ? 'anthropic' : undefined,
      oauthManager,
    };

    super(baseConfig, config);

    this.logger = new DebugLogger('llxprt:anthropic:provider');

    this.anthropic = new Anthropic({
      apiKey: apiKey || '', // Empty string if OAuth will be used
      baseURL: config?.baseUrl || baseURL,
      dangerouslyAllowBrowser: true,
    });

    this.toolFormatter = new ToolFormatter();
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Anthropic supports OAuth authentication
    return true;
  }

  /**
   * @plan:PLAN-20250823-AUTHFIXES.P15
   * @requirement:REQ-004
   * Update the Anthropic client with resolved authentication if needed
   */
  private async updateClientWithResolvedAuth(): Promise<void> {
    const resolvedToken = await this.getAuthToken();
    if (!resolvedToken) {
      throw new Error(
        'No authentication available for Anthropic API calls. Use /auth anthropic to re-authenticate or /auth anthropic logout to clear any expired session.',
      );
    }

    // Only recreate client if auth changed
    if (this._cachedAuthKey !== resolvedToken) {
      // Check if this is an OAuth token (starts with sk-ant-oat)
      const isOAuthToken = resolvedToken.startsWith('sk-ant-oat');

      // Use the unified getBaseURL() method from BaseProvider
      const baseURL = this.getBaseURL();

      if (isOAuthToken) {
        // For OAuth tokens, use authToken field which sends Bearer token
        // Don't pass apiKey at all - just authToken
        const oauthConfig: Record<string, unknown> = {
          authToken: resolvedToken, // Use authToken for OAuth Bearer tokens
          baseURL,
          dangerouslyAllowBrowser: true,
          defaultHeaders: {
            'anthropic-beta': 'oauth-2025-04-20', // Still need the beta header
          },
        };

        this.anthropic = new Anthropic(oauthConfig as ClientOptions);
      } else {
        // Regular API key auth
        this.anthropic = new Anthropic({
          apiKey: resolvedToken,
          baseURL,
          dangerouslyAllowBrowser: true,
        });
      }

      // Track the key to avoid unnecessary client recreation
      this._cachedAuthKey = resolvedToken;
    }
  }

  override async getModels(): Promise<IModel[]> {
    const authToken = await this.getAuthToken();
    if (!authToken) {
      // Return empty array if no auth - models aren't critical for operation
      this.logger.debug(
        () => 'No authentication available for fetching Anthropic models',
      );
      return [];
    }

    // Update client with resolved auth (handles OAuth vs API key)
    await this.updateClientWithResolvedAuth();

    // Check if using OAuth - the models.list endpoint doesn't work with OAuth tokens
    const isOAuthToken = authToken.startsWith('sk-ant-oat');

    if (isOAuthToken) {
      // For OAuth, return only the two working models
      this.logger.debug(
        () => 'Using hardcoded model list for OAuth authentication',
      );
      return [
        {
          id: 'claude-opus-4-1-20250805',
          name: 'Claude Opus 4.1',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 32000,
        },
        {
          id: 'claude-sonnet-4-20250514',
          name: 'Claude Sonnet 4',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 400000,
          maxOutputTokens: 64000,
        },
      ];
    }

    try {
      // Fetch models from Anthropic API (beta endpoint) - only for API keys
      const models: IModel[] = [];

      // Handle pagination
      for await (const model of this.anthropic.beta.models.list()) {
        models.push({
          id: model.id,
          name: model.display_name || model.id,
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: this.getContextWindowForModel(model.id),
          maxOutputTokens: this.getMaxTokensForModel(model.id),
        });
      }

      // Add "latest" aliases for Claude 4 tiers (opus, sonnet). We pick the newest
      // version of each tier based on the sorted order created above.
      const addLatestAlias = (tier: 'opus' | 'sonnet') => {
        const latest = models
          .filter((m) => m.id.startsWith(`claude-${tier}-4-`))
          .sort((a, b) => b.id.localeCompare(a.id))[0];
        if (latest) {
          models.push({
            ...latest,
            id: `claude-${tier}-4-latest`,
            name: latest.name.replace(/-\d{8}$/, '-latest'),
          });
        }
      };
      addLatestAlias('opus');
      addLatestAlias('sonnet');

      return models;
    } catch (error) {
      this.logger.debug(() => `Failed to fetch Anthropic models: ${error}`);
      return []; // Return empty array on error
    }
  }

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey(apiKey);

    // Create a new Anthropic client with the updated API key
    const resolvedBaseURL =
      this.providerConfig?.baseUrl || this.baseProviderConfig.baseURL;
    this.anthropic = new Anthropic({
      apiKey,
      baseURL: resolvedBaseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  override setBaseUrl(baseUrl?: string): void {
    // Call base provider implementation which stores in ephemeral settings
    super.setBaseUrl?.(baseUrl);

    // Create a new Anthropic client with the updated (or cleared) base URL
    // Will be updated with actual token in updateClientWithResolvedAuth
    const resolvedBaseURL = this.getBaseURL();
    this.anthropic = new Anthropic({
      apiKey: '', // Empty string, will be replaced when auth is resolved
      baseURL: resolvedBaseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  override setModel(modelId: string): void {
    // Update SettingsService as the source of truth
    try {
      const settingsService = getSettingsService();
      settingsService.setProviderSetting(this.name, 'model', modelId);
    } catch (error) {
      this.logger.debug(
        () => `Failed to persist model to SettingsService: ${error}`,
      );
    }
    // No local caching - always look up from SettingsService
  }

  override getCurrentModel(): string {
    // Try to get from SettingsService first (source of truth)
    try {
      const settingsService = getSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);
      if (providerSettings.model) {
        return providerSettings.model as string;
      }
    } catch (error) {
      this.logger.debug(
        () => `Failed to get model from SettingsService: ${error}`,
      );
    }
    // Always return from getDefaultModel, no caching
    return this.getDefaultModel();
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    return 'claude-sonnet-4-20250514';
  }

  /**
   * Helper method to get the latest Claude 4 model ID for a given tier.
   * This can be used when you want to ensure you're using the latest model.
   * @param tier - The model tier: 'opus', 'sonnet', or 'haiku'
   * @returns The latest model ID for that tier
   */
  getLatestClaude4Model(tier: 'opus' | 'sonnet' | 'haiku' = 'sonnet'): string {
    switch (tier) {
      case 'opus':
        return 'claude-opus-4-latest';
      case 'sonnet':
        return 'claude-sonnet-4-latest';
      case 'haiku':
        // Haiku 4 not yet available, but future-proofed
        return 'claude-haiku-4-latest';
      default:
        return 'claude-sonnet-4-latest';
    }
  }

  private getMaxTokensForModel(modelId: string): number {
    // Handle latest aliases explicitly
    if (
      modelId === 'claude-opus-4-latest' ||
      modelId.includes('claude-opus-4')
    ) {
      return 32000;
    }
    if (
      modelId === 'claude-sonnet-4-latest' ||
      modelId.includes('claude-sonnet-4')
    ) {
      return 64000;
    }

    // Try to match model patterns
    for (const { pattern, tokens } of this.modelTokenPatterns) {
      if (pattern.test(modelId)) {
        return tokens;
      }
    }

    // Default for unknown models
    return 4096;
  }

  private getContextWindowForModel(modelId: string): number {
    // Claude 4 models have larger context windows
    if (modelId.includes('claude-opus-4')) {
      return 500000;
    }
    if (modelId.includes('claude-sonnet-4')) {
      return 400000;
    }
    // Claude 3.7 models
    if (modelId.includes('claude-3-7')) {
      return 300000;
    }
    // Default for Claude 3.x models
    return 200000;
  }

  /**
   * Anthropic always requires payment (API key or OAuth)
   */
  override isPaidMode(): boolean {
    return true;
  }

  /**
   * Get the list of server tools supported by this provider
   */
  override getServerTools(): string[] {
    return [];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  override async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    throw new Error('Server tools not supported by Anthropic provider');
  }

  /**
   * Set model parameters that will be merged into API calls
   * @param params Parameters to merge with existing, or undefined to clear all
   */
  override setModelParams(params: Record<string, unknown> | undefined): void {
    const settingsService = getSettingsService();

    if (params === undefined) {
      // Clear all model params
      settingsService.setProviderSetting(this.name, 'temperature', undefined);
      settingsService.setProviderSetting(this.name, 'max_tokens', undefined);
      settingsService.setProviderSetting(this.name, 'top_p', undefined);
      settingsService.setProviderSetting(this.name, 'top_k', undefined);
    } else {
      // Set each param individually
      if ('temperature' in params) {
        settingsService.setProviderSetting(
          this.name,
          'temperature',
          params.temperature,
        );
      }
      if ('max_tokens' in params) {
        settingsService.setProviderSetting(
          this.name,
          'max_tokens',
          params.max_tokens,
        );
      }
      if ('top_p' in params) {
        settingsService.setProviderSetting(this.name, 'top_p', params.top_p);
      }
      if ('top_k' in params) {
        settingsService.setProviderSetting(this.name, 'top_k', params.top_k);
      }
      if ('stop_sequences' in params) {
        settingsService.setProviderSetting(
          this.name,
          'stop_sequences',
          params.stop_sequences,
        );
      }
    }
  }

  /**
   * Get current model parameters
   * @returns Current parameters or undefined if not set
   */
  override getModelParams(): Record<string, unknown> | undefined {
    // Always get from SettingsService
    const settingsService = getSettingsService();
    const providerSettings = settingsService.getProviderSettings(this.name);

    if (!providerSettings) {
      return undefined;
    }

    const params: Record<string, unknown> = {};
    if (providerSettings.temperature !== undefined)
      params.temperature = providerSettings.temperature;
    if (providerSettings.max_tokens !== undefined)
      params.max_tokens = providerSettings.max_tokens;
    if (providerSettings.top_p !== undefined)
      params.top_p = providerSettings.top_p;
    if (providerSettings.top_k !== undefined)
      params.top_k = providerSettings.top_k;
    if (providerSettings.stop_sequences !== undefined)
      params.stop_sequences = providerSettings.stop_sequences;

    return Object.keys(params).length > 0 ? params : undefined;
  }

  /**
   * Override clearAuthCache to also clear cached auth key
   */
  override clearAuthCache(): void {
    super.clearAuthCache();
    this._cachedAuthKey = undefined;
  }

  /**
   * Check if the provider is authenticated using any available method
   * Uses the base provider's isAuthenticated implementation
   */
  override async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }

  /**
   * Detect the appropriate tool format for the current model/configuration
   * @returns The detected tool format
   */
  detectToolFormat(): ToolFormat {
    try {
      const settingsService = getSettingsService();

      // First check SettingsService for toolFormat override in provider settings
      // Note: This is synchronous access to cached settings, not async
      const currentSettings = settingsService['settings'];
      const providerSettings = currentSettings?.providers?.[this.name];
      const toolFormatOverride = providerSettings?.toolFormat as
        | ToolFormat
        | 'auto'
        | undefined;

      // If explicitly set to a specific format (not 'auto'), use it
      if (toolFormatOverride && toolFormatOverride !== 'auto') {
        return toolFormatOverride;
      }

      // Auto-detect based on model name if set to 'auto' or not set
      const modelName = this.getCurrentModel().toLowerCase();

      // Check for GLM-4.5 models (glm-4.5, glm-4-5)
      if (modelName.includes('glm-4.5') || modelName.includes('glm-4-5')) {
        return 'qwen';
      }

      // Check for qwen models
      if (modelName.includes('qwen')) {
        return 'qwen';
      }

      // Default to 'anthropic' format
      return 'anthropic';
    } catch (error) {
      this.logger.debug(
        () => `Failed to detect tool format from SettingsService: ${error}`,
      );

      // Fallback detection without SettingsService
      const modelName = this.getCurrentModel().toLowerCase();

      if (modelName.includes('glm-4.5') || modelName.includes('glm-4-5')) {
        return 'qwen';
      }

      if (modelName.includes('qwen')) {
        return 'qwen';
      }

      return 'anthropic';
    }
  }

  override getToolFormat(): ToolFormat {
    // Use the same detection logic as detectToolFormat()
    return this.detectToolFormat();
  }

  /**
   * Set tool format override for this provider
   * @param format The format to use, or null to clear override
   */
  override setToolFormatOverride(format: string | null): void {
    const settingsService = getSettingsService();
    if (format === null) {
      settingsService.setProviderSetting(this.name, 'toolFormat', 'auto');
      this.logger.debug(() => `Tool format override cleared for ${this.name}`);
    } else {
      settingsService.setProviderSetting(this.name, 'toolFormat', format);
      this.logger.debug(
        () => `Tool format override set to '${format}' for ${this.name}`,
      );
    }

    // Clear cached auth key to ensure new format takes effect
    this._cachedAuthKey = undefined;
  }

  /**
   * Normalize tool IDs from various formats to Anthropic format
   * Handles IDs from OpenAI (call_xxx), Anthropic (toolu_xxx), and history (hist_tool_xxx)
   */
  private normalizeToAnthropicToolId(id: string): string {
    // If already in Anthropic format, return as-is
    if (id.startsWith('toolu_')) {
      return id;
    }

    // For history format, extract the UUID and add Anthropic prefix
    if (id.startsWith('hist_tool_')) {
      const uuid = id.substring('hist_tool_'.length);
      return 'toolu_' + uuid;
    }

    // For OpenAI format, extract the UUID and add Anthropic prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'toolu_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'toolu_' + id;
  }

  /**
   * Normalize tool IDs from Anthropic format to history format
   */
  private normalizeToHistoryToolId(id: string): string {
    // If already in history format, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // For Anthropic format, extract the UUID and add history prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'hist_tool_' + uuid;
    }

    // For OpenAI format, extract the UUID and add history prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'hist_tool_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'hist_tool_' + id;
  }

  /**
   * Generate chat completion with IContent interface
   * Convert IContent directly to Anthropic API format
   */
  async *generateChatCompletion(
    content: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent> {
    // Convert IContent directly to Anthropic API format (no IMessage!)
    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | { type: 'tool_result'; tool_use_id: string; content: string }
          >;
    }> = [];

    // Extract system message if present
    // let systemMessage: string | undefined;

    // Filter out orphaned tool responses at the beginning of the conversation
    // TODO: Investigate post-0.2.2 - These shouldn't be truly orphaned since the same
    // history works with OpenAI/Cerebras. Likely Anthropic has stricter formatting
    // requirements for tool responses that we're not fully meeting yet.
    let startIndex = 0;
    while (
      startIndex < content.length &&
      content[startIndex].speaker === 'tool'
    ) {
      this.logger.debug(
        () => `Skipping orphaned tool response at beginning of conversation`,
      );
      startIndex++;
    }
    const filteredContent = content.slice(startIndex);

    // Group consecutive tool responses together for Anthropic API
    let pendingToolResults: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
    }> = [];

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        anthropicMessages.push({
          role: 'user',
          content: pendingToolResults,
        });
        pendingToolResults = [];
      }
    };

    for (const c of filteredContent) {
      if (c.speaker === 'human') {
        // Flush any pending tool results before adding a human message
        flushToolResults();

        const textBlock = c.blocks.find((b) => b.type === 'text') as
          | TextBlock
          | undefined;

        // Add text block as user message
        anthropicMessages.push({
          role: 'user',
          content: textBlock?.text || '',
        });
      } else if (c.speaker === 'ai') {
        // Flush any pending tool results before adding an AI message
        flushToolResults();
        const textBlocks = c.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCallBlocks = c.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        if (toolCallBlocks.length > 0) {
          // Build content array with text and tool_use blocks
          const contentArray: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
          > = [];

          // Add text if present
          const contentText = textBlocks.map((b) => b.text).join('');
          if (contentText) {
            contentArray.push({ type: 'text', text: contentText });
          }

          // Add tool uses
          for (const tc of toolCallBlocks) {
            // Ensure parameters are an object, not a string
            let parametersObj = tc.parameters;
            if (typeof parametersObj === 'string') {
              try {
                parametersObj = JSON.parse(parametersObj);
              } catch (e) {
                this.logger.debug(
                  () => `Failed to parse tool parameters as JSON: ${e}`,
                );
                parametersObj = {};
              }
            }
            contentArray.push({
              type: 'tool_use',
              id: this.normalizeToAnthropicToolId(tc.id),
              name: tc.name,
              input: parametersObj,
            });
          }

          anthropicMessages.push({
            role: 'assistant',
            content: contentArray,
          });
        } else {
          // Text-only message
          const contentText = textBlocks.map((b) => b.text).join('');
          anthropicMessages.push({
            role: 'assistant',
            content: contentText,
          });
        }
      } else if (c.speaker === 'tool') {
        const toolResponseBlock = c.blocks.find(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock | undefined;
        if (!toolResponseBlock) {
          throw new Error('Tool content must have a tool_response block');
        }

        // Collect tool results to be grouped together
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: this.normalizeToAnthropicToolId(
            toolResponseBlock.callId,
          ),
          content: JSON.stringify(toolResponseBlock.result),
        });
      } else {
        throw new Error(`Unknown speaker type: ${c.speaker}`);
      }
    }

    // Flush any remaining tool results at the end
    flushToolResults();

    // Validate that all tool_results have corresponding tool_uses
    // Anthropic requires strict pairing between tool_use and tool_result
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const msg of anthropicMessages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolUseIds.add(block.id);
          }
        }
      } else if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            toolResultIds.add(block.tool_use_id);
          }
        }
      }
    }

    // Remove orphaned tool results (results without corresponding tool uses)
    const orphanedResults = Array.from(toolResultIds).filter(
      (id) => !toolUseIds.has(id),
    );
    if (orphanedResults.length > 0) {
      this.logger.debug(
        () =>
          `Found ${orphanedResults.length} orphaned tool results, removing them`,
      );

      // Filter out messages that only contain orphaned tool results
      const filteredMessages = anthropicMessages.filter((msg) => {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const filteredContent = msg.content.filter(
            (block) =>
              block.type !== 'tool_result' ||
              !orphanedResults.includes(block.tool_use_id),
          );
          if (filteredContent.length === 0) {
            // Remove empty user messages
            return false;
          }
          msg.content = filteredContent;
        }
        return true;
      });

      // Replace the messages array
      anthropicMessages.length = 0;
      anthropicMessages.push(...filteredMessages);
    }

    // Ensure the conversation starts with a valid message type
    // Anthropic requires the first message to be from the user
    if (anthropicMessages.length > 0 && anthropicMessages[0].role !== 'user') {
      // If the first message is not from the user, add a minimal user message
      this.logger.debug(
        () => `First message is not from user, adding placeholder user message`,
      );
      anthropicMessages.unshift({
        role: 'user',
        content: 'Continue the conversation',
      });
    }

    // Ensure we have at least one message
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({
        role: 'user',
        content: 'Hello',
      });
    }

    // Detect the tool format to use
    const detectedFormat = this.detectToolFormat();

    // Convert Gemini format tools to the detected format
    const anthropicTools = this.toolFormatter.convertGeminiToFormat(
      tools,
      detectedFormat,
    ) as
      | Array<{
          name: string;
          description: string;
          input_schema: {
            type: 'object';
            properties?: Record<string, unknown>;
            required?: string[];
          };
        }>
      | undefined;

    // Ensure authentication
    await this.updateClientWithResolvedAuth();

    // Check OAuth mode
    const authToken = await this.getAuthToken();
    const isOAuth = authToken && authToken.startsWith('sk-ant-oat');

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting =
      this.providerConfig?.getEphemeralSettings?.()?.['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Build request with proper typing
    const currentModel = this.getCurrentModel();
    // Get the system prompt for non-OAuth mode
    const userMemory = this.globalConfig?.getUserMemory
      ? this.globalConfig.getUserMemory()
      : '';

    // For OAuth mode, inject core system prompt as the first human message
    if (isOAuth) {
      const corePrompt = await getCoreSystemPromptAsync(
        userMemory,
        currentModel,
        undefined,
      );
      if (corePrompt) {
        anthropicMessages.unshift({
          role: 'user',
          content: `<system>\n${corePrompt}\n</system>\n\nUser provided conversation begins here:`,
        });
      }
    }

    const systemPrompt = !isOAuth
      ? await getCoreSystemPromptAsync(userMemory, currentModel, undefined)
      : undefined;
    const requestBody = {
      model: currentModel,
      messages: anthropicMessages,
      max_tokens: this.getMaxTokensForModel(currentModel),
      stream: streamingEnabled,
      ...(this.getModelParams() || {}),
      ...(isOAuth
        ? {
            system: "You are Claude Code, Anthropic's official CLI for Claude.",
          }
        : systemPrompt
          ? { system: systemPrompt }
          : {}),
      ...(anthropicTools && anthropicTools.length > 0
        ? { tools: anthropicTools }
        : {}),
    };

    // Debug log the tools being sent to Anthropic
    if (anthropicTools && anthropicTools.length > 0) {
      this.logger.debug(() => `[AnthropicProvider] Sending tools to API:`, {
        toolCount: anthropicTools.length,
        toolNames: anthropicTools.map((t) => t.name),
        firstTool: anthropicTools[0],
        requestHasTools: 'tools' in requestBody,
      });
    }

    // Make the API call directly with type assertion
    const response = await this.anthropic.messages.create(
      requestBody as Parameters<typeof this.anthropic.messages.create>[0],
    );

    if (streamingEnabled) {
      // Handle streaming response - response is already a Stream when streaming is enabled
      const stream =
        response as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;
      let currentToolCall:
        | { id: string; name: string; input: string }
        | undefined;

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: '',
            };
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            // Emit text immediately as IContent
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: chunk.delta.text }],
            } as IContent;
          } else if (
            chunk.delta.type === 'input_json_delta' &&
            currentToolCall
          ) {
            currentToolCall.input += chunk.delta.partial_json;

            // Check for double-escaping patterns
            const detectedFormat = this.detectToolFormat();
            logDoubleEscapingInChunk(
              chunk.delta.partial_json,
              currentToolCall.name,
              detectedFormat,
            );
          }
        } else if (chunk.type === 'content_block_stop') {
          if (currentToolCall) {
            // Process tool parameters with double-escape handling
            const detectedFormat = this.detectToolFormat();
            const processedParameters = processToolParameters(
              currentToolCall.input,
              currentToolCall.name,
              detectedFormat,
            );

            yield {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: this.normalizeToHistoryToolId(currentToolCall.id),
                  name: currentToolCall.name,
                  parameters: processedParameters,
                },
              ],
            } as IContent;
            currentToolCall = undefined;
          }
        } else if (chunk.type === 'message_delta' && chunk.usage) {
          // Emit usage metadata
          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: chunk.usage.input_tokens || 0,
                completionTokens: chunk.usage.output_tokens || 0,
                totalTokens:
                  (chunk.usage.input_tokens || 0) +
                  (chunk.usage.output_tokens || 0),
              },
            },
          } as IContent;
        }
      }
    } else {
      // Handle non-streaming response
      const message = response as Anthropic.Message;
      const blocks: ContentBlock[] = [];

      // Process content blocks
      const detectedFormat = this.detectToolFormat();

      for (const contentBlock of message.content) {
        if (contentBlock.type === 'text') {
          blocks.push({ type: 'text', text: contentBlock.text } as TextBlock);
        } else if (contentBlock.type === 'tool_use') {
          // Process tool parameters with double-escape handling
          const processedParameters = processToolParameters(
            JSON.stringify(contentBlock.input),
            contentBlock.name,
            detectedFormat,
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(contentBlock.id),
            name: contentBlock.name,
            parameters: processedParameters,
          } as ToolCallBlock);
        }
      }

      // Build response IContent
      const result: IContent = {
        speaker: 'ai',
        blocks,
      };

      // Add usage metadata if present
      if (message.usage) {
        result.metadata = {
          usage: {
            promptTokens: message.usage.input_tokens,
            completionTokens: message.usage.output_tokens,
            totalTokens:
              message.usage.input_tokens + message.usage.output_tokens,
          },
        };
      }

      yield result;
    }
  }
}
