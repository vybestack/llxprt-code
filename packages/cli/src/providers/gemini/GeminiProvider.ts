/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider, IModel, IMessage, ITool } from '../IProvider.js';
import { Config, AuthType } from '@vybestack/llxprt-code-core';
import { ContentGeneratorRole } from '../types.js';
import type { Part, FunctionCall, Schema } from '@google/genai';
import { AuthenticationRequiredError } from '../errors.js';

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 *
 * NOTE: This provider acts as a configuration layer for the native Gemini integration.
 * It doesn't implement generateChatCompletion directly but instead configures the
 * system to use the native Gemini client with the appropriate authentication.
 */
type GeminiAuthMode = 'oauth' | 'gemini-api-key' | 'vertex-ai' | 'none';

export class GeminiProvider implements IProvider {
  readonly name: string = 'gemini';
  readonly isDefault: boolean = true;
  private apiKey?: string;
  private authMode: GeminiAuthMode = 'none';
  private config?: Config;
  private currentModel: string = 'gemini-2.5-pro';
  private modelExplicitlySet: boolean = false;
  private authDetermined: boolean = false;

  constructor() {
    // Do not determine auth mode on instantiation.
    // This will be done lazily when a chat completion is requested.
  }

  /**
   * Determines the best available authentication method based on environment variables
   * and existing configuration. Follows the hierarchy: Vertex AI → Gemini API key → OAuth
   */
  private determineBestAuth(): void {
    // Skip if already determined
    if (this.authDetermined) {
      return;
    }

    // Mark as determined early to prevent concurrent determinations
    this.authDetermined = true;

    // Check if user explicitly selected USE_NONE via the content generator config
    const authType = this.config?.getContentGeneratorConfig()?.authType;
    if (authType === AuthType.USE_NONE) {
      this.authMode = 'none';
      return;
    }

    // If authType is USE_PROVIDER and no credentials exist, fall back to OAuth
    if (authType === AuthType.USE_PROVIDER) {
      if (!this.hasVertexAICredentials() && !this.hasGeminiAPIKey()) {
        this.authMode = 'oauth';
        return;
      }
    }

    // Check for Vertex AI credentials first
    if (this.hasVertexAICredentials()) {
      this.authMode = 'vertex-ai';
      this.setupVertexAIAuth();
    }
    // Check for Gemini API key second
    else if (this.hasGeminiAPIKey()) {
      this.authMode = 'gemini-api-key';
      // API key is already in environment, no additional setup needed
    }
    // Fall back to OAuth (will prompt user if needed)
    else {
      this.authMode = 'oauth';
      // OAuth will be handled by the existing auth system
    }
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
    return !!this.apiKey || !!process.env.GEMINI_API_KEY;
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
  setConfig(config: Config): void {
    this.config = config;

    // Sync with config model if user hasn't explicitly set a model
    // This ensures consistency between config and provider state
    const configModel = config.getModel();

    if (!this.modelExplicitlySet && configModel) {
      this.currentModel = configModel;
    }

    // Clear auth cache when config changes to allow re-determination
    this.authDetermined = false;
    // Re-determine auth after config is set
    this.determineBestAuth();
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
          id: 'gemini-2.5-flash-exp',
          name: 'Gemini 2.5 Flash Experimental',
          provider: this.name,
          supportedToolFormats: [],
        },
      ];
    }

    // For API key modes (gemini-api-key or vertex-ai), try to fetch real models
    if (this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai') {
      const apiKey = this.apiKey || process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
            {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );

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

  /**
   * Checks if OAuth authentication is still valid
   */
  private async isOAuthValid(): Promise<boolean> {
    if (this.authMode !== 'oauth') return true;

    // Check if we have valid OAuth tokens
    // This would need to interact with the core auth system
    try {
      // For now, assume OAuth is valid if we've already determined auth
      // A more robust check would query the auth status from the config
      return this.authDetermined;
    } catch {
      return false;
    }
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    // Check if we need to re-determine auth
    const oauthValid = await this.isOAuthValid();
    if (!oauthValid) {
      this.authDetermined = false;
    }

    // Lazily determine the best auth method now that it's needed.
    this.determineBestAuth();

    // Early authentication validation - check if we have the required credentials
    // for the determined auth mode BEFORE processing messages

    switch (this.authMode) {
      case 'gemini-api-key':
        if (!this.apiKey && !process.env.GEMINI_API_KEY) {
          throw new AuthenticationRequiredError(
            'Gemini API key required but not found. Please set GEMINI_API_KEY environment variable or use /auth to login with Google OAuth.',
            this.authMode,
            ['GEMINI_API_KEY'],
          );
        }
        break;

      case 'vertex-ai':
        if (!process.env.GOOGLE_API_KEY) {
          throw new AuthenticationRequiredError(
            'Google API key required for Vertex AI. Please set GOOGLE_API_KEY environment variable or use /auth to login with Google OAuth.',
            this.authMode,
            ['GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
          );
        }
        break;

      case 'oauth':
        // OAuth auth will be validated when creating the content generator
        break;

      case 'none':
        // In 'none' mode, check if ANY credentials are available
        if (!this.hasGeminiAPIKey() && !this.hasVertexAICredentials()) {
          throw new AuthenticationRequiredError(
            'No authentication credentials found. Please use /auth to login with Google OAuth, set GEMINI_API_KEY, or configure Vertex AI credentials.',
            this.authMode,
            ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          );
        }
        break;

      default:
        // For any other auth mode, proceed without validation
        break;
    }

    // Import the necessary modules dynamically to avoid circular dependencies
    const { GoogleGenAI } = await import('@google/genai');

    // Create the appropriate client based on auth mode
    let genAI: InstanceType<typeof GoogleGenAI>;
    const httpOptions = {
      headers: {
        'User-Agent': `GeminiCLI/${process.env.CLI_VERSION || process.version} (${process.platform}; ${process.arch})`,
      },
    };

    switch (this.authMode) {
      case 'gemini-api-key':
        if (!this.apiKey && !process.env.GEMINI_API_KEY) {
          throw new Error('Gemini API key required but not found');
        }
        genAI = new GoogleGenAI({
          apiKey: this.apiKey || process.env.GEMINI_API_KEY,
          httpOptions,
        });
        break;

      case 'vertex-ai':
        if (!process.env.GOOGLE_API_KEY) {
          throw new Error('Google API key required for Vertex AI');
        }
        genAI = new GoogleGenAI({
          apiKey: process.env.GOOGLE_API_KEY,
          vertexai: true,
          httpOptions,
        });
        break;

      case 'oauth': {
        // For OAuth, we need to use the code assist server
        const { createCodeAssistContentGenerator } = await import(
          '@vybestack/llxprt-code-core'
        );
        const contentGenerator = await createCodeAssistContentGenerator(
          httpOptions,
          AuthType.LOGIN_WITH_GOOGLE,
          this.config!,
        );

        // Convert messages to Gemini request format
        // Use config model in OAuth mode to ensure synchronization
        const oauthModel = this.modelExplicitlySet
          ? this.currentModel
          : this.config?.getModel() || this.currentModel;

        const request = {
          model: oauthModel,
          contents: this.convertMessagesToGeminiFormat(messages),
          config: {
            tools: tools ? this.convertToolsToGeminiFormat(tools) : undefined,
          },
        };

        // Use the content generator stream
        const streamResult =
          await contentGenerator.generateContentStream(request);

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
        // For 'none' mode, check what credentials are available
        if (this.hasGeminiAPIKey()) {
          genAI = new GoogleGenAI({
            apiKey: this.apiKey || process.env.GEMINI_API_KEY,
            httpOptions,
          });
        } else if (this.hasVertexAICredentials()) {
          this.setupVertexAIAuth();
          genAI = new GoogleGenAI({
            apiKey: process.env.GOOGLE_API_KEY!,
            vertexai: true,
            httpOptions,
          });
        } else {
          throw new Error(
            'No authentication credentials found. Please use /auth to login with Google OAuth, set GEMINI_API_KEY, or configure Vertex AI credentials.',
          );
        }
        break;

      default:
        throw new Error(`Unsupported auth mode: ${this.authMode}`);
    }

    // Get the models interface (which is a ContentGenerator)
    const contentGenerator = genAI.models;

    // Convert IMessage[] to Gemini format
    const contents = this.convertMessagesToGeminiFormat(messages);

    // Convert ITool[] to Gemini tool format
    const geminiTools = tools
      ? this.convertToolsToGeminiFormat(tools)
      : undefined;

    // Create the request - ContentGenerator expects model in the request
    // Use explicit model if set, otherwise fall back to config model
    const modelToUse = this.modelExplicitlySet
      ? this.currentModel
      : this.config?.getModel() || this.currentModel;

    const request = {
      model: modelToUse,
      contents,
      config: {
        tools: geminiTools,
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
          console.warn(
            `Tool response at index ${i} missing tool_call_id, skipping:`,
            msg,
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
            console.warn(
              `Tool call at message ${i} missing ID, generating one:`,
              toolCall,
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
        console.warn(
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
      console.warn(
        `Function parts count mismatch: ${totalFunctionCalls} calls vs ${totalFunctionResponses} responses`,
      );
      console.warn('Function calls:', callsDetail);
      console.warn('Function responses:', responsesDetail);
      console.warn('Unmatched call IDs:', Array.from(unmatchedCalls));
      console.warn('Unmatched response IDs:', Array.from(unmatchedResponses));

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
    return [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters as Schema,
        })),
      },
    ];
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    // Set the API key as an environment variable so it can be used by the core library
    process.env.GEMINI_API_KEY = apiKey;

    // Clear auth cache when API key changes
    this.authDetermined = false;
    // Re-determine auth after API key is set
    this.determineBestAuth();
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
  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * Sets the current model ID
   */
  setModel(modelId: string): void {
    this.currentModel = modelId;
    this.modelExplicitlySet = true;

    // Always update config if available, not just in OAuth mode
    // This ensures the model is properly synchronized
    if (this.config) {
      this.config.setModel(modelId);
    }
  }

  /**
   * Checks if the current auth mode requires payment
   */
  isPaidMode(): boolean {
    return this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai';
  }

  /**
   * Clears provider state but preserves explicitly set model
   */
  clearState(): void {
    // Clear auth-related state
    this.authMode = 'none';
    this.authDetermined = false;
    // Only reset model if it wasn't explicitly set by user
    if (!this.modelExplicitlySet) {
      this.currentModel = 'gemini-2.5-pro';
    }
    // Note: We don't clear config or apiKey as they might be needed
  }

  /**
   * Forces re-determination of auth method
   */
  clearAuthCache(): void {
    this.authDetermined = false;
    // Don't clear the auth mode itself, just the determination flag
    // This allows for smoother transitions
  }
}
