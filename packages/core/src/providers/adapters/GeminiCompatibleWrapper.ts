/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider as Provider } from '../IProvider.js';
import type { IMessage as ProviderMessage } from '../IMessage.js';
import type { ITool as ProviderTool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import {
  Content,
  GenerateContentResponse,
  GenerateContentConfig,
  Part,
  ContentListUnion,
} from '@google/genai';
import {
  GeminiEventType,
  ToolCallRequestInfo,
  ServerGeminiStreamEvent,
  ServerGeminiContentEvent,
  ServerGeminiToolCallRequestEvent,
  ServerGeminiUsageMetadataEvent,
} from '../../core/turn.js';

/**
 * Wrapper that makes any IProvider compatible with Gemini's ContentGenerator interface
 */

export class GeminiCompatibleWrapper {
  private readonly provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  /**
   * Converts Gemini schema format to standard JSON Schema format
   * Handles uppercase type enums and string numeric values
   */
  private convertGeminiSchemaToStandard(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const newSchema: Record<string, unknown> = { ...schema };

    // Handle schema composition keywords
    if (newSchema.anyOf && Array.isArray(newSchema.anyOf)) {
      newSchema.anyOf = newSchema.anyOf.map((v) =>
        this.convertGeminiSchemaToStandard(v),
      );
    }
    if (newSchema.allOf && Array.isArray(newSchema.allOf)) {
      newSchema.allOf = newSchema.allOf.map((v) =>
        this.convertGeminiSchemaToStandard(v),
      );
    }
    if (newSchema.oneOf && Array.isArray(newSchema.oneOf)) {
      newSchema.oneOf = newSchema.oneOf.map((v) =>
        this.convertGeminiSchemaToStandard(v),
      );
    }

    // Handle items (can be a schema or array of schemas for tuples)
    if (newSchema.items) {
      if (Array.isArray(newSchema.items)) {
        newSchema.items = newSchema.items.map((item) =>
          this.convertGeminiSchemaToStandard(item),
        );
      } else {
        newSchema.items = this.convertGeminiSchemaToStandard(newSchema.items);
      }
    }

    // Handle properties
    if (newSchema.properties && typeof newSchema.properties === 'object') {
      const newProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.properties)) {
        newProperties[key] = this.convertGeminiSchemaToStandard(value);
      }
      newSchema.properties = newProperties;
    }

    // Handle additionalProperties if it's a schema
    if (
      newSchema.additionalProperties &&
      typeof newSchema.additionalProperties === 'object'
    ) {
      newSchema.additionalProperties = this.convertGeminiSchemaToStandard(
        newSchema.additionalProperties,
      );
    }

    // Handle patternProperties
    if (
      newSchema.patternProperties &&
      typeof newSchema.patternProperties === 'object'
    ) {
      const newPatternProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.patternProperties)) {
        newPatternProperties[key] = this.convertGeminiSchemaToStandard(value);
      }
      newSchema.patternProperties = newPatternProperties;
    }

    // Handle dependencies (can be array of property names or schema)
    if (newSchema.dependencies && typeof newSchema.dependencies === 'object') {
      const newDependencies: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.dependencies)) {
        if (Array.isArray(value)) {
          // Property dependencies (array of property names)
          newDependencies[key] = value;
        } else {
          // Schema dependencies
          newDependencies[key] = this.convertGeminiSchemaToStandard(value);
        }
      }
      newSchema.dependencies = newDependencies;
    }

    // Handle if/then/else
    if (newSchema.if) {
      newSchema.if = this.convertGeminiSchemaToStandard(newSchema.if);
    }
    if (newSchema.then) {
      newSchema.then = this.convertGeminiSchemaToStandard(newSchema.then);
    }
    if (newSchema.else) {
      newSchema.else = this.convertGeminiSchemaToStandard(newSchema.else);
    }

    // Handle not
    if (newSchema.not) {
      newSchema.not = this.convertGeminiSchemaToStandard(newSchema.not);
    }

    // Convert type from UPPERCASE enum to lowercase string
    if (newSchema.type) {
      newSchema.type = String(newSchema.type).toLowerCase();
    }

    // Convert all numeric properties from strings to numbers
    const numericProperties = [
      'minItems',
      'maxItems',
      'minLength',
      'maxLength',
      'minimum',
      'maximum',
      'minProperties',
      'maxProperties',
      'multipleOf',
    ];

    for (const prop of numericProperties) {
      if (newSchema[prop] !== undefined) {
        newSchema[prop] = Number(newSchema[prop]);
      }
    }

    return newSchema;
  }

  /**
   * Convert Gemini tools format to provider tools format
   */
  private convertGeminiToolsToProviderTools(
    geminiTools: Array<{
      functionDeclarations?: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ): ProviderTool[] {
    const providerTools: ProviderTool[] = [];

    for (const tool of geminiTools) {
      if (tool.functionDeclarations) {
        // Gemini format has functionDeclarations array
        for (const func of tool.functionDeclarations) {
          providerTools.push({
            type: 'function' as const,
            function: {
              name: func.name,
              description: func.description || '',
              parameters: (this.convertGeminiSchemaToStandard(
                func.parameters,
              ) as Record<string, unknown>) ?? {
                type: 'object',
                properties: {},
                required: [],
              },
            },
          });
        }
      }
    }

    return providerTools;
  }

  /**
   * Generate content using the wrapped provider (non-streaming)
   * @param params Parameters for content generation
   * @returns A promise resolving to a Gemini-formatted response
   */
  async generateContent(params: {
    model: string;
    contents: ContentListUnion;
    config?: GenerateContentConfig;
  }): Promise<GenerateContentResponse> {
    // Convert Gemini contents to provider messages
    const messages = this.convertContentsToMessages(params.contents);

    // Collect full response from provider stream
    const responseMessages: ProviderMessage[] = [];
    const stream = this.provider.generateChatCompletion(messages);

    for await (const chunk of stream) {
      responseMessages.push(chunk as ProviderMessage);
    }

    // Convert provider response to Gemini format
    return this.convertMessagesToResponse(responseMessages);
  }

  /**
   * Generate content using the wrapped provider (streaming)
   * @param params Parameters for content generation
   * @returns An async generator yielding Gemini-formatted responses
   */
  async *generateContentStream(params: {
    model: string;
    contents: ContentListUnion;
    config?: GenerateContentConfig;
  }): AsyncGenerator<GenerateContentResponse> {
    // Convert Gemini contents to provider messages
    let messages = this.convertContentsToMessages(params.contents);

    // Add system instruction if provided
    if (params.config?.systemInstruction) {
      let systemContent: string;

      // Handle different systemInstruction formats
      if (typeof params.config.systemInstruction === 'string') {
        systemContent = params.config.systemInstruction;
      } else {
        // It's a ContentUnion - convert to string
        const systemMessages = this.convertContentsToMessages(
          params.config.systemInstruction,
        );
        systemContent = systemMessages.map((m) => m.content).join('\n');
      }

      messages = [
        {
          role: 'system' as const,
          content: systemContent,
        },
        ...messages,
      ];
    }

    // Extract and convert tools from config if available
    let providerTools: ProviderTool[] | undefined;
    const geminiTools = (params.config as { tools?: unknown })?.tools;
    if (geminiTools && Array.isArray(geminiTools)) {
      providerTools = this.convertGeminiToolsToProviderTools(geminiTools);
    }

    // Stream from provider and convert each chunk
    const stream = this.provider.generateChatCompletion(
      messages,
      providerTools,
    );

    // Collect all chunks to batch telemetry events
    const collectedChunks: GenerateContentResponse[] = [];
    let hasUsageMetadata = false;

    for await (const chunk of stream) {
      const response = this.convertMessageToStreamResponse(
        chunk as ProviderMessage,
      );
      collectedChunks.push(response);

      // Check if this chunk has usage metadata
      if ((chunk as ProviderMessage).usage) {
        hasUsageMetadata = true;
      }

      // Yield the response chunk immediately for UI updates
      yield response;
    }

    // After streaming is complete, yield a final response with usage metadata if we collected any
    // This mimics how geminiChat.ts logs telemetry after collecting all chunks
    if (hasUsageMetadata && collectedChunks.length > 0) {
      // Find the last chunk with usage metadata
      const lastChunkWithUsage = [...collectedChunks].reverse().find((chunk) =>
        // Check if any message in the chunk had usage data
        chunk.candidates?.some((candidate) =>
          candidate.content?.parts?.some((part: Part) => 'usage' in part),
        ),
      );

      // The telemetry will be logged by the consuming code when it sees the usage metadata
      if (lastChunkWithUsage) {
        // Usage data is included in the stream for telemetry purposes
        void lastChunkWithUsage; // Mark as intentionally unused
      }
    }
  }

  /**
   * Adapts a provider's stream to Gemini event format
   * @param providerStream The provider-specific stream
   * @returns An async iterator of Gemini events
   */
  async *adaptStream(
    providerStream: AsyncIterableIterator<ProviderMessage>,
  ): AsyncIterableIterator<ServerGeminiStreamEvent> {
    yield* this.adaptProviderStream(providerStream);
  }

  /**
   * Adapts the provider's stream format to Gemini's expected format
   * @param providerStream Stream from the provider
   * @returns Async iterator of Gemini events
   */
  private async *adaptProviderStream(
    providerStream: AsyncIterableIterator<ProviderMessage>,
  ): AsyncIterableIterator<ServerGeminiStreamEvent> {
    for await (const message of providerStream) {
      // Emit content event if message has non-empty content
      if (message.content && message.content.length > 0) {
        const contentValue =
          typeof message.content === 'string'
            ? message.content
            : String(message.content);
        const contentEvent: ServerGeminiContentEvent = {
          type: GeminiEventType.Content,
          value: contentValue,
        };
        yield contentEvent;
      }

      // Emit tool call events if message has tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (_e) {
            // Use empty object as fallback
          }

          const toolEvent: ServerGeminiToolCallRequestEvent = {
            type: GeminiEventType.ToolCallRequest,
            value: {
              callId: toolCall.id,
              name: toolCall.function.name,
              args,
              isClientInitiated: false,
            } as ToolCallRequestInfo,
          };
          yield toolEvent;
        }
      }

      // Emit usage metadata event if message has usage data
      if (message.usage) {
        const usageEvent: ServerGeminiUsageMetadataEvent = {
          type: GeminiEventType.UsageMetadata,
          value: {
            promptTokenCount: message.usage.prompt_tokens,
            candidatesTokenCount: message.usage.completion_tokens,
            totalTokenCount: message.usage.total_tokens,
          },
        };
        yield usageEvent;
      }
    }
  }

  /**
   * Convert Gemini ContentListUnion to provider ProviderMessage array
   */
  private convertContentsToMessages(
    contents: ContentListUnion,
  ): ProviderMessage[] {
    // Debug logging for OpenRouter issue
    if (process.env.DEBUG) {
      console.log(
        '[GeminiCompatibleWrapper] convertContentsToMessages input:',
        {
          type: Array.isArray(contents) ? 'array' : typeof contents,
          length: Array.isArray(contents) ? contents.length : 'N/A',
          contents: JSON.stringify(contents).substring(0, 500),
        },
      );
    }

    // Normalize ContentListUnion to Content[]
    let contentArray: Content[];

    // Check if contents is undefined or null
    if (!contents) {
      return [];
    }

    if (Array.isArray(contents)) {
      // Filter out any undefined/null elements
      const validContents = contents.filter(
        (item) => item !== undefined && item !== null,
      );

      // If it's already an array, check if it's Content[] or PartUnion[]
      if (validContents.length === 0) {
        contentArray = [];
      } else if (
        validContents[0] &&
        typeof validContents[0] === 'object' &&
        'role' in validContents[0]
      ) {
        // It's Content[]
        contentArray = validContents as Content[];
      } else {
        // It's PartUnion[] - convert to Part[] and wrap in a single Content with user role
        const parts: Part[] = validContents.map((item) =>
          typeof item === 'string' ? { text: item } : (item as Part),
        );

        // Special handling: check if all parts are functionResponses
        const _allFunctionResponses = parts.every(
          (part) =>
            part && typeof part === 'object' && 'functionResponse' in part,
        );

        contentArray = [
          {
            role: 'user',
            parts,
          },
        ];
      }
    } else if (typeof contents === 'string') {
      // It's a string - wrap in Part and Content
      contentArray = [
        {
          role: 'user',
          parts: [{ text: contents }],
        },
      ];
    } else if (
      typeof contents === 'object' &&
      contents !== null &&
      'role' in contents
    ) {
      // It's a single Content
      contentArray = [contents as Content];
    } else {
      // It's a single Part - wrap in Content with user role
      contentArray = [
        {
          role: 'user',
          parts: [contents as Part],
        },
      ];
    }

    const messages: ProviderMessage[] = [];

    for (const content of contentArray) {
      // Validate content object
      if (!content || typeof content !== 'object') {
        continue;
      }

      if (!content.role) {
        continue;
      }
      // Check for function responses (tool results)
      const functionResponses = (content.parts || []).filter(
        (
          part,
        ): part is
          | (Part & {
              functionResponse: {
                id: string;
                name: string;
                response: {
                  error?: string;
                  llmContent?: string;
                  output?: string;
                };
              };
            })
          | (Part & {
              functionResponse: {
                name: string;
                response: {
                  error?: string;
                  llmContent?: string;
                  output?: string;
                };
              };
            }) => 'functionResponse' in part,
      );

      if (functionResponses.length > 0) {
        // Check for other parts that need to be preserved (like PDFs)
        const nonFunctionResponseParts = (content.parts || []).filter(
          (part) => !('functionResponse' in part),
        );

        // Collect any binary content from function responses
        const binaryParts: Part[] = [];

        // Convert each function response to a tool message
        for (const part of functionResponses) {
          const response = part.functionResponse.response;
          let content: string;

          // Check if response contains binary content
          if (
            response &&
            typeof response === 'object' &&
            'binaryContent' in response
          ) {
            // Extract the binary content
            const binaryContent = response.binaryContent as Part;
            if (binaryContent) {
              binaryParts.push(binaryContent);
            }
            content = response.output || `Processed binary content`;
          } else if (typeof response === 'string') {
            content = response;
          } else if (response?.error) {
            content = `Error: ${response.error}`;
          } else if (response?.llmContent) {
            content = String(response.llmContent);
          } else if (response?.output) {
            content = String(response.output);
          } else {
            content = JSON.stringify(response);
          }

          const toolCallId = (part.functionResponse as { id?: string }).id;
          if (!toolCallId) {
            throw new Error(
              `Tool response for '${part.functionResponse.name}' is missing required tool_call_id. This ID must match the original tool call ID from the model.`,
            );
          }

          messages.push({
            role: 'tool',
            content,
            tool_call_id: toolCallId,
            name: part.functionResponse.name,
          } as ProviderMessage);
        }

        // If there are binary parts from function responses or non-functionResponse parts, add them as user messages
        const allBinaryParts = [...binaryParts, ...nonFunctionResponseParts];
        if (allBinaryParts.length > 0) {
          const binaryMessage: ProviderMessage = {
            role: ContentGeneratorRole.USER,
            content: '',
          };

          // Only include parts field for Gemini provider
          if (this.provider.name === 'gemini') {
            binaryMessage.parts = allBinaryParts;
          }

          messages.push(binaryMessage);
        }
      } else {
        // Check for function calls (tool calls from the model)
        const functionCalls = (content.parts || []).filter(
          (
            part,
          ): part is Part & {
            functionCall: {
              id?: string;
              name: string;
              args?: Record<string, unknown>;
            };
          } => 'functionCall' in part,
        );

        // Get all parts
        const allParts = content.parts || [];

        // Extract text content
        const textParts = allParts
          .filter((part): part is Part & { text: string } => 'text' in part)
          .map((part) => part.text);
        const combinedText = textParts.join('');

        // Map Gemini roles to provider roles
        let role: ContentGeneratorRole | 'system';
        if (content.role === 'model') {
          role = ContentGeneratorRole.ASSISTANT;
        } else if (content.role === 'user') {
          role = ContentGeneratorRole.USER;
        } else if (content.role === 'system') {
          role = 'system';
        } else {
          role = content.role as ContentGeneratorRole | 'system';
        }

        const message: ProviderMessage = {
          role,
          content: combinedText,
        };

        // Only include parts field for Gemini provider
        // OpenAI and Anthropic don't support the parts field
        if (this.provider.name === 'gemini') {
          // Preserve all parts including non-text content (PDFs, images, etc.)
          message.parts = allParts;
        }

        // If this is an assistant message with function calls, add them
        if (role === 'assistant' && functionCalls.length > 0) {
          message.tool_calls = functionCalls.map((part) => ({
            id:
              part.functionCall.id ||
              `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'function' as const,
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          }));
        }

        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * Convert provider messages to a single Gemini response
   */
  private convertMessagesToResponse(
    messages: ProviderMessage[],
  ): GenerateContentResponse {
    // Combine all messages into a single response
    const combinedContent = messages.map((m) => m.content || '').join('');
    const parts: Part[] = [];

    // Add text content
    if (combinedContent) {
      parts.push({ text: combinedContent });
    }

    // Add tool calls as function calls
    for (const message of messages) {
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (_e) {
            // Use empty object as fallback
          }

          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args,
            },
          } as Part);
        }
      }

      // CRITICAL FIX: Preserve parts from the message (PDFs, images, etc.)
      if (message.parts && message.parts.length > 0) {
        parts.push(...message.parts);
      }
    }

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
        },
      ],
    } as GenerateContentResponse;
  }

  /**
   * Convert a single provider message to a streaming Gemini response
   */
  private convertMessageToStreamResponse(
    message: ProviderMessage,
  ): GenerateContentResponse {
    const parts: Part[] = [];

    // Add text content if present
    if (message.content) {
      parts.push({ text: message.content });
    }

    // Add tool calls as function calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (_e) {
          // Use empty object as fallback
        }

        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args,
            // Store the tool call ID in the functionCall for later retrieval
            id: toolCall.id,
          },
        } as Part);
      }
    }

    // CRITICAL FIX: Preserve parts from the message (PDFs, images, etc.)
    if (message.parts && message.parts.length > 0) {
      parts.push(...message.parts);
    }

    const response: GenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
        },
      ],
    } as GenerateContentResponse;

    // Include usage metadata if present in the message
    // This ensures telemetry is only triggered when we have complete usage data
    if (message.usage) {
      response.usageMetadata = {
        promptTokenCount: message.usage.prompt_tokens || 0,
        candidatesTokenCount: message.usage.completion_tokens || 0,
        totalTokenCount: message.usage.total_tokens || 0,
      };
    }

    return response;
  }
}
