/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';
import {
  Config,
  AuthType,
  ContentGeneratorRole,
  AuthenticationRequiredError,
  getCoreSystemPromptAsync,
  createCodeAssistContentGenerator,
} from '@vybestack/llxprt-code-core';
import type {
  Part,
  FunctionCall,
  Schema,
  GenerateContentParameters,
} from '@google/genai';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import { OAuthManager } from '../../auth/precedence.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P12
 * @requirement REQ-003.1, REQ-003.2, REQ-003.3
 * @pseudocode lines 12-18, 21-26
 */

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 *
 * NOTE: This provider acts as a configuration layer for the native Gemini integration.
 * It doesn't implement generateChatCompletion directly but instead configures the
 * system to use the native Gemini client with the appropriate authentication.
 */
type GeminiAuthMode = 'oauth' | 'gemini-api-key' | 'vertex-ai' | 'none';

export class GeminiProvider extends BaseProvider {
  private logger: DebugLogger;
  private authMode: GeminiAuthMode = 'none';
  private geminiConfig?: Config;
  private currentModel: string = 'gemini-2.5-pro';
  private modelExplicitlySet: boolean = false;
  private baseURL?: string;
  private modelParams?: Record<string, unknown>;
  private toolSchemas:
    | Array<{
        functionDeclarations: Array<{
          name: string;
          description?: string;
          parameters?: Schema;
        }>;
      }>
    | undefined;
  private geminiOAuthManager?: OAuthManager;

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: Config,
    oauthManager?: OAuthManager,
  ) {
    // Initialize base provider with auth configuration
    const baseConfig: BaseProviderConfig = {
      name: 'gemini',
      apiKey,
      baseURL,
      cliKey: apiKey, // CLI --key argument
      envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      isOAuthEnabled: false, // OAuth enablement will be checked dynamically
      oauthProvider: 'gemini',
      oauthManager, // Keep the manager for checking enablement
    };

    super(baseConfig);

    this.logger = new DebugLogger('llxprt:gemini:provider');
    // Store Gemini-specific configuration
    this.geminiConfig = config;
    this.baseURL = baseURL;
    this.geminiOAuthManager = oauthManager;

    // Do not determine auth mode on instantiation.
    // This will be done lazily when a chat completion is requested.
  }

  /**
   * Updates OAuth configuration based on current OAuth manager state
   */
  private updateOAuthState(): void {
    if (this.geminiOAuthManager) {
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      if (
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function'
      ) {
        const isEnabled = manager.isOAuthEnabled('gemini');
        // Update the OAuth configuration
        this.updateOAuthConfig(isEnabled, 'gemini', this.geminiOAuthManager);
      }
    }
  }

  /**
   * Determines the best available authentication method based on environment variables
   * and existing configuration. Now uses lazy evaluation with proper precedence chain.
   */
  private async determineBestAuth(): Promise<string> {
    // Re-check OAuth enablement state before determining auth
    this.updateOAuthState();

    // Use the base provider's auth precedence resolution
    try {
      const token = await this.getAuthToken();

      // Check if OAuth is enabled for Gemini but no token was returned
      // This signals to use the existing LOGIN_WITH_GOOGLE flow
      const authMethodName = await this.getAuthMethodName();
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      const isOAuthEnabled =
        manager?.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function' &&
        manager.isOAuthEnabled('gemini');

      // CRITICAL FIX: Only use LOGIN_WITH_GOOGLE if OAuth is actually enabled
      // Don't fall back to it when OAuth is disabled
      if (
        isOAuthEnabled &&
        (authMethodName?.startsWith('oauth-') ||
          (this.geminiOAuthManager && !token))
      ) {
        this.authMode = 'oauth';
        // Return a special token for OAuth mode
        return 'USE_LOGIN_WITH_GOOGLE';
      }

      // Determine auth mode based on resolved authentication method
      if (this.hasVertexAICredentials()) {
        this.authMode = 'vertex-ai';
        this.setupVertexAIAuth();
      } else if (this.hasGeminiAPIKey() || authMethodName?.includes('key')) {
        this.authMode = 'gemini-api-key';
      } else {
        this.authMode = 'none';
      }

      return token;
    } catch (error) {
      // CRITICAL FIX: Only fall back to LOGIN_WITH_GOOGLE if OAuth is actually enabled
      // Don't use it when OAuth has been disabled
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      const isOAuthEnabled =
        this.geminiOAuthManager &&
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function' &&
        manager.isOAuthEnabled('gemini');

      if (isOAuthEnabled) {
        this.authMode = 'oauth';
        return 'USE_LOGIN_WITH_GOOGLE';
      }

      // Handle case where no auth is available
      const authType = this.geminiConfig?.getContentGeneratorConfig()?.authType;
      if (authType === AuthType.USE_NONE) {
        this.authMode = 'none';
        throw new AuthenticationRequiredError(
          'Authentication is set to USE_NONE but no credentials are available',
          this.authMode,
          ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        );
      }
      throw error;
    }
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Check if OAuth is actually enabled for Gemini in the OAuth manager
    const manager = this.geminiOAuthManager as OAuthManager & {
      isOAuthEnabled?(provider: string): boolean;
    };

    if (
      manager?.isOAuthEnabled &&
      typeof manager.isOAuthEnabled === 'function'
    ) {
      return manager.isOAuthEnabled('gemini');
    }

    // Default to false if OAuth manager is not available
    // This ensures we don't fall back to LOGIN_WITH_GOOGLE when OAuth is disabled
    return false;
  }

  /**
   * Checks if Vertex AI credentials are available
   */
  private hasVertexAICredentials(): boolean {
    const hasProjectAndLocation =
      !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
    const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
    return hasProjectAndLocation || hasGoogleApiKey;
  }

  /**
   * Checks if Gemini API key is available
   */
  private hasGeminiAPIKey(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  /**
   * Sets up environment variables for Vertex AI authentication
   */
  private setupVertexAIAuth(): void {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    // Other Vertex AI env vars are already set, no need to duplicate
  }

  /**
   * Sets the config instance for reading OAuth credentials
   */
  override setConfig(config: Config): void {
    this.geminiConfig = config;

    // Sync with config model if user hasn't explicitly set a model
    // This ensures consistency between config and provider state
    const configModel = config.getModel();

    if (!this.modelExplicitlySet && configModel) {
      this.currentModel = configModel;
    }

    // Update OAuth configuration based on OAuth manager state, not config authType
    // This ensures that if OAuth is disabled via /auth gemini disable, it stays disabled
    this.updateOAuthState();

    // Clear auth cache when config changes to allow re-determination
  }

  async getModels(): Promise<IModel[]> {
    // For OAuth mode, return fixed list of models
    if (this.authMode === 'oauth') {
      return [
        {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          provider: this.name,
          supportedToolFormats: [],
        },
        {
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          provider: this.name,
          supportedToolFormats: [],
        },
        {
          id: 'gemini-2.5-flash-lite',
          name: 'Gemini 2.5 Flash Lite',
          provider: this.name,
          supportedToolFormats: [],
        },
      ];
    }

    // For API key modes (gemini-api-key or vertex-ai), try to fetch real models
    if (this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai') {
      const apiKey = (await this.getAuthToken()) || process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const url = this.baseURL
            ? `${this.baseURL.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`
            : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = (await response.json()) as {
              models?: Array<{
                name: string;
                displayName?: string;
                description?: string;
              }>;
            };

            if (data.models && data.models.length > 0) {
              return data.models.map((model) => ({
                id: model.name.replace('models/', ''), // Remove 'models/' prefix
                name: model.displayName || model.name,
                provider: this.name,
                supportedToolFormats: [],
              }));
            }
          }
        } catch (_error) {
          // Fall through to default models
        }
      }
    }

    // Return default models as fallback
    return [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-2.5-flash-exp',
        name: 'Gemini 2.5 Flash Experimental',
        provider: this.name,
        supportedToolFormats: [],
      },
    ];
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    // Comprehensive debug logging
    this.logger.debug(
      () => `generateChatCompletion called with ${messages.length} messages`,
    );
    this.logger.debug(() => `Messages: ${JSON.stringify(messages, null, 2)}`);
    this.logger.debug(
      () =>
        `First message: ${messages[0] ? JSON.stringify(messages[0], null, 2) : 'NO FIRST MESSAGE'}`,
    );
    this.logger.debug(
      () =>
        `Tools: ${tools ? JSON.stringify(tools.map((t) => t.function.name)) : 'NO TOOLS'}`,
    );
    // Lazily determine the best auth method now that it's needed.
    // This implements lazy OAuth triggering - OAuth is only triggered when making API calls
    let authToken: string;
    try {
      authToken = await this.determineBestAuth();
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        throw error;
      }
      throw new AuthenticationRequiredError(
        'Failed to resolve authentication for Gemini provider',
        this.authMode,
        ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      );
    }

    // Authentication has already been resolved by determineBestAuth()
    // No need for additional validation since the auth token is already obtained

    // Import the necessary modules dynamically to avoid circular dependencies
    const { GoogleGenAI } = await import('@google/genai');

    // Create the appropriate client based on auth mode
    let genAI: InstanceType<typeof GoogleGenAI>;
    const httpOptions = {
      headers: {
        'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
      },
    };

    switch (this.authMode) {
      case 'gemini-api-key':
        genAI = new GoogleGenAI({
          apiKey: authToken,
          httpOptions: this.baseURL
            ? {
                ...httpOptions,
                baseUrl: this.baseURL,
              }
            : httpOptions,
        });
        break;

      case 'vertex-ai':
        genAI = new GoogleGenAI({
          apiKey: authToken,
          vertexai: true,
          httpOptions: this.baseURL
            ? {
                ...httpOptions,
                baseUrl: this.baseURL,
              }
            : httpOptions,
        });
        break;

      case 'oauth': {
        // For OAuth, create a minimal config-like object if we don't have one
        const configForOAuth = this.geminiConfig || {
          getProxy: () => undefined, // OAuth only needs this from config
        };

        // For OAuth, we need to use the code assist server
        const contentGenerator = await createCodeAssistContentGenerator(
          httpOptions,
          AuthType.LOGIN_WITH_GOOGLE,
          configForOAuth as Config,
          this.baseURL,
        );

        // Convert messages to Gemini request format
        // Use config model in OAuth mode to ensure synchronization
        const oauthModel = this.modelExplicitlySet
          ? this.currentModel
          : this.geminiConfig?.getModel() || this.currentModel;

        // Generate systemInstruction using getCoreSystemPrompt

        // Get user memory from config if available
        const userMemory = this.geminiConfig?.getUserMemory
          ? this.geminiConfig.getUserMemory()
          : '';
        const systemInstruction = await getCoreSystemPromptAsync(
          userMemory,
          oauthModel,
        );

        // Store tools if provided
        if (tools && tools.length > 0) {
          this.toolSchemas = this.convertToolsToGeminiFormat(tools);
        }

        // Use provided tools or stored tools
        let geminiTools = tools
          ? this.convertToolsToGeminiFormat(tools)
          : this.toolSchemas;

        // For Flash models, always include tools if available
        if (oauthModel.includes('flash') && !geminiTools && this.toolSchemas) {
          geminiTools = this.toolSchemas;
        }

        const request = {
          model: oauthModel,
          contents: this.convertMessagesToGeminiFormat(messages),
          systemInstruction,
          config: {
            tools: geminiTools,
            ...this.modelParams,
          },
        };

        // Use the content generator stream
        // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
        const streamResult = await contentGenerator.generateContentStream(
          request,
          'oauth-session', // userPromptId for OAuth mode
        );

        // Reset global state variables after successful authentication
        /**
         * @plan PLAN-20250822-GEMINIFALLBACK.P12
         * @requirement REQ-003.3
         * @pseudocode lines 17-18, 25-26
         */
        (global as Record<string, unknown>).__oauth_needs_code = false;
        (global as Record<string, unknown>).__oauth_provider = undefined;

        // Convert the stream to our format
        for await (const response of streamResult) {
          // Extract text from the response
          const text =
            response.candidates?.[0]?.content?.parts
              ?.filter((part: Part) => 'text' in part)
              ?.map((part: Part) => (part as { text: string }).text)
              ?.join('') || '';

          // Extract function calls from the response
          const functionCalls =
            response.candidates?.[0]?.content?.parts
              ?.filter((part: Part) => 'functionCall' in part)
              ?.map(
                (part: Part) =>
                  (part as { functionCall: FunctionCall }).functionCall,
              ) || [];

          // Build response message
          const message: IMessage = {
            role: ContentGeneratorRole.ASSISTANT,
            content: text,
          };

          // Add function calls if any
          if (functionCalls && functionCalls.length > 0) {
            message.tool_calls = functionCalls.map((call: FunctionCall) => ({
              id:
                call.id ||
                `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              type: 'function' as const,
              function: {
                name: call.name || 'unknown_function',
                arguments: JSON.stringify(call.args || {}),
              },
            }));
          }

          // Only yield if there's content or tool calls
          if (text || (functionCalls && functionCalls.length > 0)) {
            yield message;
          }
        }
        return;
      }

      case 'none':
        // For 'none' mode, use the resolved auth token
        genAI = new GoogleGenAI({
          apiKey: authToken,
          vertexai: this.hasVertexAICredentials(),
          httpOptions: this.baseURL
            ? {
                ...httpOptions,
                baseUrl: this.baseURL,
              }
            : httpOptions,
        });
        break;

      default:
        throw new Error(`Unsupported auth mode: ${this.authMode}`);
    }

    // Get the models interface (which is a ContentGenerator)
    const contentGenerator = genAI.models;

    // Store tools if provided
    if (tools && tools.length > 0) {
      this.toolSchemas = this.convertToolsToGeminiFormat(tools);
    }

    // Convert IMessage[] to Gemini format - do this after storing tools so priming can access them
    const contents = this.convertMessagesToGeminiFormat(messages);

    // Use provided tools or stored tools
    let geminiTools = tools
      ? this.convertToolsToGeminiFormat(tools)
      : this.toolSchemas;

    // Create the request - ContentGenerator expects model in the request
    // Use explicit model if set, otherwise fall back to config model
    const modelToUse = this.modelExplicitlySet
      ? this.currentModel
      : this.geminiConfig?.getModel() || this.currentModel;

    // For Flash models, always include tools if available
    if (modelToUse.includes('flash') && !geminiTools && this.toolSchemas) {
      geminiTools = this.toolSchemas;
    }

    // Generate systemInstruction using getCoreSystemPrompt

    // Get user memory from config if available
    const userMemory = this.geminiConfig?.getUserMemory
      ? this.geminiConfig.getUserMemory()
      : '';
    const systemInstruction = await getCoreSystemPromptAsync(
      userMemory,
      modelToUse,
    );

    const request = {
      model: modelToUse,
      contents,
      systemInstruction,
      config: {
        tools: geminiTools,
        ...this.modelParams,
      },
    };

    // Generate content stream using the ContentGenerator interface
    const stream = await contentGenerator.generateContentStream(request);

    // Stream the response
    for await (const response of stream) {
      // Extract text from the response
      const text =
        response.candidates?.[0]?.content?.parts
          ?.filter((part: Part) => 'text' in part)
          ?.map((part: Part) => (part as { text: string }).text)
          ?.join('') || '';

      // Extract function calls from the response
      const functionCalls =
        response.candidates?.[0]?.content?.parts
          ?.filter((part: Part) => 'functionCall' in part)
          ?.map(
            (part: Part) =>
              (part as { functionCall: FunctionCall }).functionCall,
          ) || [];

      // Build response message
      const message: IMessage = {
        role: ContentGeneratorRole.ASSISTANT,
        content: text || '',
      };

      // Add function calls if any
      if (functionCalls && functionCalls.length > 0) {
        message.tool_calls = functionCalls.map((call: FunctionCall) => ({
          id:
            call.id ||
            `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'function' as const,
          function: {
            name: call.name || 'unknown_function',
            arguments: JSON.stringify(call.args || {}),
          },
        }));
      }

      // Only yield if there's content or tool calls
      if (text || (functionCalls && functionCalls.length > 0)) {
        yield message;
      }
    }
  }

  private convertMessagesToGeminiFormat(
    messages: IMessage[],
  ): Array<{ role: string; parts: Part[] }> {
    const contents: Array<{ role: string; parts: Part[] }> = [];

    // Enhanced tracking with more details
    const functionCalls = new Map<
      string,
      {
        name: string;
        contentIndex: number;
        partIndex: number;
        messageIndex: number; // Track which message this came from
      }
    >();
    const functionResponses = new Map<
      string,
      {
        name: string;
        contentIndex: number;
        messageIndex: number;
      }
    >();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Handle tool responses - each in its own Content object
      if (msg.role === ContentGeneratorRole.TOOL) {
        if (!msg.tool_call_id) {
          this.logger.debug(
            () =>
              `Tool response at index ${i} missing tool_call_id, skipping: ${JSON.stringify(msg)}`,
          );
          continue;
        }

        functionResponses.set(msg.tool_call_id, {
          name: msg.tool_name || 'unknown_function',
          contentIndex: contents.length,
          messageIndex: i,
        });

        // Add each tool response as a separate content immediately
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: msg.tool_call_id,
                name: msg.tool_name || 'unknown_function',
                response: {
                  output: msg.content || '',
                },
              },
            },
          ],
        });
        continue;
      }

      // For non-tool messages, convert normally
      const parts: Part[] = [];

      // Check for parts first (for messages with PDF/image parts but no text content)
      if (msg.parts && msg.parts.length > 0) {
        parts.push(...(msg.parts as Part[]));
      } else if (msg.content) {
        // Handle PartListUnion: string | Part | Part[]
        // In practice, content can be PartListUnion even though IMessage types it as string
        const content = msg.content as string | Part | Part[];

        if (typeof content === 'string') {
          // Try to parse string in case it's a stringified Part or Part[]
          if (
            (content.startsWith('{') && content.endsWith('}')) ||
            (content.startsWith('[') && content.endsWith(']'))
          ) {
            try {
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                parts.push(...parsed);
              } else {
                parts.push(parsed);
              }
            } catch (_e) {
              // Not valid JSON, treat as text
              parts.push({ text: content });
            }
          } else {
            parts.push({ text: content });
          }
        } else if (Array.isArray(content)) {
          // Content is Part[]
          parts.push(...content);
        } else {
          // Content is a single Part
          parts.push(content);
        }
      }

      // Handle tool calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Check if function calls were already added via parts
        const existingFunctionCallIds = new Set<string>();
        if (msg.parts && msg.parts.length > 0) {
          for (const part of parts) {
            if ('functionCall' in part) {
              const fc = part as { functionCall: FunctionCall };
              if (fc.functionCall.id) {
                existingFunctionCallIds.add(fc.functionCall.id);
              }
            }
          }
        }

        for (const toolCall of msg.tool_calls) {
          // Skip if this function call was already added via parts
          if (toolCall.id && existingFunctionCallIds.has(toolCall.id)) {
            continue;
          }

          // Ensure tool call has an ID
          if (!toolCall.id) {
            this.logger.debug(
              () =>
                `Tool call at message ${i} missing ID, generating one: ${JSON.stringify(toolCall)}`,
            );
            // Generate a unique ID for the function call
            toolCall.id = `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          }

          const partIndex = parts.length;

          parts.push({
            functionCall: {
              id: toolCall.id,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            },
          } as Part);

          // Track this function call with its position
          functionCalls.set(toolCall.id, {
            name: toolCall.function.name,
            contentIndex: contents.length,
            partIndex,
            messageIndex: i,
          });
        }
      }

      // Map roles
      let role = 'user';
      if (msg.role === ContentGeneratorRole.ASSISTANT) {
        role = 'model';
      } else if (msg.role === ContentGeneratorRole.USER) {
        role = 'user';
      } else if (msg.role === 'system') {
        // Gemini doesn't have system role in contents, handle separately
        role = 'user';
      }

      if (parts.length > 0) {
        contents.push({
          role,
          parts,
        });
      }
    }

    // Validate and add missing function responses
    for (const [callId, callInfo] of Array.from(functionCalls.entries())) {
      if (!functionResponses.has(callId)) {
        // Create a placeholder response for missing function response
        this.logger.debug(
          () =>
            `Function call ${callInfo.name} (id: ${callId}) has no matching response, adding placeholder`,
        );

        // Add each function response as a separate content object (same as regular tool responses)
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: callId,
                name: callInfo.name,
                response: {
                  output: JSON.stringify({
                    error:
                      'Function call was interrupted or no response received',
                    message: `The function "${callInfo.name}" was called but did not receive a response. This may occur if the function execution was interrupted, requires authentication, or encountered an error.`,
                    callId,
                    functionName: callInfo.name,
                  }),
                },
              },
            },
          ],
        });

        // Mark this response as added
        functionResponses.set(callId, {
          name: callInfo.name,
          contentIndex: contents.length - 1,
          messageIndex: -1, // Placeholder response doesn't have original message index
        });
      }
    }

    // Final validation - count function calls and responses
    let totalFunctionCalls = 0;
    let totalFunctionResponses = 0;
    const callsDetail: string[] = [];
    const responsesDetail: string[] = [];
    const unmatchedCalls = new Set<string>();
    const unmatchedResponses = new Set<string>();

    // First pass: collect all function calls and responses with their IDs
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      for (const part of content.parts) {
        if ('functionCall' in part) {
          totalFunctionCalls++;
          const fc = part as { functionCall: FunctionCall };
          callsDetail.push(
            `${i}: ${fc.functionCall.name} (${fc.functionCall.id})`,
          );
          if (fc.functionCall.id) {
            unmatchedCalls.add(fc.functionCall.id);
          }
        } else if ('functionResponse' in part) {
          totalFunctionResponses++;
          const fr = part as { functionResponse: { id: string; name: string } };
          responsesDetail.push(
            `${i}: ${fr.functionResponse.name} (${fr.functionResponse.id})`,
          );
          if (fr.functionResponse.id) {
            unmatchedResponses.add(fr.functionResponse.id);
          }
        }
      }
    }

    // Second pass: match calls with responses
    for (const id of unmatchedCalls) {
      if (unmatchedResponses.has(id)) {
        unmatchedCalls.delete(id);
        unmatchedResponses.delete(id);
      }
    }

    if (totalFunctionCalls !== totalFunctionResponses) {
      this.logger.debug(
        () =>
          `Function parts count mismatch: ${totalFunctionCalls} calls vs ${totalFunctionResponses} responses`,
      );
      this.logger.debug(() => `Function calls: ${JSON.stringify(callsDetail)}`);
      this.logger.debug(
        () => `Function responses: ${JSON.stringify(responsesDetail)}`,
      );
      this.logger.debug(
        () =>
          `Unmatched call IDs: ${JSON.stringify(Array.from(unmatchedCalls))}`,
      );
      this.logger.debug(
        () =>
          `Unmatched response IDs: ${JSON.stringify(Array.from(unmatchedResponses))}`,
      );

      // This is now just a warning, not an error, since we've added placeholders
      // The Gemini API should handle this gracefully
    }

    return contents;
  }

  private convertToolsToGeminiFormat(tools: ITool[]): Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: Schema;
    }>;
  }> {
    const result = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters as Schema,
        })),
      },
    ];

    this.logger.debug(
      () =>
        `Converted tools to Gemini format: ${JSON.stringify(result, null, 2)}`,
    );

    return result;
  }

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey?.(apiKey);

    // Set the API key as an environment variable so it can be used by the core library
    // CRITICAL FIX: When clearing the key (empty string), delete the env var instead of setting to empty
    if (apiKey && apiKey.trim() !== '') {
      process.env.GEMINI_API_KEY = apiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }

    // Clear auth cache when API key changes
    this.clearAuthCache();
  }

  override setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided or it's an empty string, clear to undefined
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;
  }

  /**
   * Gets the current authentication mode
   */
  getAuthMode(): GeminiAuthMode {
    return this.authMode;
  }

  /**
   * Gets the appropriate AuthType for the core library
   */
  getCoreAuthType(): AuthType {
    switch (this.authMode) {
      case 'oauth':
        return AuthType.LOGIN_WITH_GOOGLE;
      case 'gemini-api-key':
        return AuthType.USE_GEMINI;
      case 'vertex-ai':
        return AuthType.USE_VERTEX_AI;
      default:
        return AuthType.LOGIN_WITH_GOOGLE; // Default to OAuth
    }
  }

  /**
   * Gets the current model ID
   */
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
    // Fall back to cached value or default
    return this.currentModel || this.getDefaultModel();
  }

  /**
   * Gets the default model for Gemini
   */
  override getDefaultModel(): string {
    return 'gemini-2.5-pro';
  }

  /**
   * Sets the current model ID
   */
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

    // Keep local cache for performance
    this.currentModel = modelId;
    this.modelExplicitlySet = true;

    // Always update config if available, not just in OAuth mode
    // This ensures the model is properly synchronized
    if (this.geminiConfig) {
      this.geminiConfig.setModel(modelId);
    }
  }

  /**
   * Sets additional model parameters to include in requests
   */
  override setModelParams(params: Record<string, unknown> | undefined): void {
    if (params === undefined) {
      this.modelParams = undefined;
    } else {
      this.modelParams = { ...this.modelParams, ...params };
    }
  }

  /**
   * Gets the current model parameters
   */
  override getModelParams(): Record<string, unknown> | undefined {
    return this.modelParams;
  }

  /**
   * Checks if the current auth mode requires payment
   */
  override isPaidMode(): boolean {
    return this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai';
  }

  /**
   * Clears provider state but preserves explicitly set model
   */
  override clearState(): void {
    // Clear auth-related state
    this.authMode = 'none';
    // Only reset model if it wasn't explicitly set by user
    if (!this.modelExplicitlySet) {
      this.currentModel = 'gemini-2.5-pro';
    }
    // Note: We don't clear config or apiKey as they might be needed
  }

  /**
   * Forces re-determination of auth method
   */
  override clearAuthCache(): void {
    // Call the base implementation to clear the cached token
    super.clearAuthCache();
    // Don't clear the auth mode itself, just allow re-determination next time
  }

  /**
   * Get the list of server tools supported by this provider
   */
  override getServerTools(): string[] {
    return ['web_search', 'web_fetch'];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  override async invokeServerTool(
    toolName: string,
    params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    if (toolName === 'web_search') {
      // Import the necessary modules dynamically
      const { GoogleGenAI } = await import('@google/genai');

      // Create the appropriate client based on auth mode
      const httpOptions = {
        headers: {
          'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
        },
      };

      let genAI: InstanceType<typeof GoogleGenAI>;

      // Get authentication token lazily
      const authToken = await this.determineBestAuth();

      switch (this.authMode) {
        case 'gemini-api-key': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const contentGenerator = genAI.models;

          const apiKeyRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: (params as { query: string }).query }],
              },
            ],
            config: {
              tools: [{ googleSearch: {} }],
            },
          };

          const apiKeyResult =
            await contentGenerator.generateContent(apiKeyRequest);
          return apiKeyResult;
        }

        case 'vertex-ai': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            vertexai: true,
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const vertexContentGenerator = genAI.models;

          const vertexRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: (params as { query: string }).query }],
              },
            ],
            config: {
              tools: [{ googleSearch: {} }],
            },
          };

          const vertexResult =
            await vertexContentGenerator.generateContent(vertexRequest);
          return vertexResult;
        }

        case 'oauth': {
          // For OAuth, use the code assist content generator
          const oauthContentGenerator = await createCodeAssistContentGenerator(
            httpOptions,
            AuthType.LOGIN_WITH_GOOGLE,
            this.geminiConfig!,
          );

          // For web search, always use gemini-2.5-flash regardless of the active model
          const oauthRequest: GenerateContentParameters = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: (params as { query: string }).query }],
              },
            ],
            config: {
              tools: [{ googleSearch: {} }],
            },
          };
          // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
          const result = await oauthContentGenerator.generateContent(
            oauthRequest,
            'web-search-oauth', // userPromptId for OAuth web search
          );
          return result;
        }

        default:
          throw new Error(
            `Web search not supported in auth mode: ${this.authMode}`,
          );
      }
    } else if (toolName === 'web_fetch') {
      // Import the necessary modules dynamically
      const { GoogleGenAI } = await import('@google/genai');

      // Get the prompt directly without any processing
      const prompt = (params as { prompt: string }).prompt;

      // Create the appropriate client based on auth mode
      const httpOptions = {
        headers: {
          'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
        },
      };

      let genAI: InstanceType<typeof GoogleGenAI>;

      // Get authentication token lazily
      const authToken = await this.determineBestAuth();

      switch (this.authMode) {
        case 'gemini-api-key': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const contentGenerator = genAI.models;

          const apiKeyRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              tools: [{ urlContext: {} }],
            },
          };

          const apiKeyResult =
            await contentGenerator.generateContent(apiKeyRequest);
          return apiKeyResult;
        }

        case 'vertex-ai': {
          genAI = new GoogleGenAI({
            apiKey: authToken,
            vertexai: true,
            httpOptions: this.baseURL
              ? {
                  ...httpOptions,
                  baseUrl: this.baseURL,
                }
              : httpOptions,
          });

          // Get the models interface (which is a ContentGenerator)
          const vertexContentGenerator = genAI.models;

          const vertexRequest = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              tools: [{ urlContext: {} }],
            },
          };

          const vertexResult =
            await vertexContentGenerator.generateContent(vertexRequest);
          return vertexResult;
        }

        case 'oauth': {
          // For OAuth, use the code assist content generator
          const oauthContentGenerator = await createCodeAssistContentGenerator(
            httpOptions,
            AuthType.LOGIN_WITH_GOOGLE,
            this.geminiConfig!,
          );

          // For web fetch, always use gemini-2.5-flash regardless of the active model
          const oauthRequest: GenerateContentParameters = {
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              tools: [{ urlContext: {} }],
            },
          };
          // PRIVACY FIX: Removed sessionId to prevent transmission to Google servers
          const result = await oauthContentGenerator.generateContent(
            oauthRequest,
            'web-fetch-oauth', // userPromptId for OAuth web fetch
          );
          return result;
        }

        default:
          throw new Error(
            `Web fetch not supported in auth mode: ${this.authMode}`,
          );
      }
    } else {
      throw new Error(`Unknown server tool: ${toolName}`);
    }
  }
}
