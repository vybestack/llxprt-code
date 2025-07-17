/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider, IModel, IMessage, ITool } from '../IProvider.js';
import { Config, AuthType } from '@vybestack/llxprt-code-core';
import { ContentGeneratorRole } from '../types.js';
import type { Part, FunctionCall, Schema } from '@google/genai';

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

  constructor() {
    // Do not determine auth mode on instantiation.
    // This will be done lazily when a chat completion is requested.
  }

  /**
   * Determines the best available authentication method based on environment variables
   * and existing configuration. Follows the hierarchy: Vertex AI → Gemini API key → OAuth
   */
  private determineBestAuth(): void {
    // Check if user explicitly selected USE_NONE via the content generator config
    const authType = this.config?.getContentGeneratorConfig()?.authType;
    if (authType === AuthType.USE_NONE) {
      this.authMode = 'none';
      return;
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
    ];
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    // Lazily determine the best auth method now that it's needed.
    this.determineBestAuth();

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
        const request = {
          model: this.currentModel,
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
          throw new Error('No authentication credentials found. Please set GEMINI_API_KEY or configure Vertex AI credentials.');
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
    const request = {
      model: this.currentModel,
      contents,
      config: {
        tools: geminiTools,
      },
    };

    // Generate content stream using the ContentGenerator interface
    const stream = await contentGenerator.generateContentStream(request);

    // Stream the response
    for await (const response of stream) {
      // Debug: Log the response structure
      if (response.candidates?.[0]?.content?.parts) {
        console.debug(
          '[GeminiProvider] Response parts:',
          JSON.stringify(response.candidates[0].content.parts, null, 2),
        );
      }

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

      // Debug: Log extracted function calls
      if (functionCalls.length > 0) {
        console.debug(
          '[GeminiProvider] Function calls found:',
          JSON.stringify(functionCalls, null, 2),
        );
      }

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
    let currentToolResponses: Part[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Handle tool responses - group consecutive ones together
      if (msg.role === ContentGeneratorRole.TOOL && msg.tool_call_id) {
        currentToolResponses.push({
          functionResponse: {
            id: msg.tool_call_id,
            name: msg.tool_name || 'unknown_function',
            response: {
              output: msg.content,
            },
          },
        } as Part);

        // Check if next message is also a tool response
        const isLastMessage = i === messages.length - 1;
        const nextIsNotTool =
          isLastMessage || messages[i + 1].role !== ContentGeneratorRole.TOOL;

        if (nextIsNotTool && currentToolResponses.length > 0) {
          // Flush accumulated tool responses as a single Content
          console.log(
            `[GeminiProvider] Grouping ${currentToolResponses.length} tool responses into single Content`,
          );
          contents.push({
            role: 'user',
            parts: currentToolResponses,
          });
          currentToolResponses = [];
        }
        continue;
      }

      // For non-tool messages, convert normally
      const parts: Part[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Handle tool calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          parts.push({
            functionCall: {
              id: toolCall.id,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            },
          } as Part);
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
  }

  /**
   * Checks if the current auth mode requires payment
   */
  isPaidMode(): boolean {
    return this.authMode === 'gemini-api-key' || this.authMode === 'vertex-ai';
  }
}
