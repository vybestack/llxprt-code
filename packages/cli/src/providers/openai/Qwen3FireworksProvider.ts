/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenAIProvider } from './OpenAIProvider.js';
import { IMessage, ITool, IModel } from '../IProvider.js';
import { Settings } from '../../config/settings.js';
import { ContentGeneratorRole } from '../types.js';

/**
 * Qwen3-Fireworks provider that extends OpenAI provider with Qwen3-specific handling
 * Fireworks AI provides an OpenAI-compatible API for Qwen3-235B model
 */
export class Qwen3FireworksProvider extends OpenAIProvider {
  name = 'qwen3-fireworks';
  private partialBuffer = '';
  private streamTimeout: NodeJS.Timeout | null = null;
  private lastStreamActivity = 0;
  
  constructor(apiKey: string, settings?: Settings) {
    // Initialize with Fireworks API endpoint
    super(apiKey, 'https://api.fireworks.ai/inference/v1', settings);
    
    // Set the default model for Qwen3
    this.setModel('accounts/fireworks/models/qwen3-235b-a22b');
  }

  /**
   * Override to return Qwen3-specific models
   */
  async getModels(): Promise<IModel[]> {
    return [
      {
        id: 'accounts/fireworks/models/qwen3-235b-a22b',
        name: 'Qwen3 235B',
        provider: this.name,
        supportedToolFormats: ['openai'], // Fireworks uses OpenAI format
      },
    ];
  }

  /**
   * Override generateChatCompletion to handle Qwen3-specific content cleaning
   */
  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
  ): AsyncIterableIterator<IMessage> {
    // Debug logging to see what messages Qwen3 receives
    console.log('[Qwen3FireworksProvider] Received messages:', JSON.stringify(messages, null, 2));
    console.log('[Qwen3FireworksProvider] Number of messages:', messages.length);
    
    // Log tool messages specifically
    const toolMessages = messages.filter(m => m.role === 'tool');
    if (toolMessages.length > 0) {
      console.log('[Qwen3FireworksProvider] Tool messages found:', toolMessages.length);
      toolMessages.forEach((msg, idx) => {
        console.log(`[Qwen3FireworksProvider] Tool message ${idx}:`, {
          tool_call_id: msg.tool_call_id,
          tool_name: msg.tool_name,
          content_length: msg.content?.length || 0,
          content_preview: msg.content?.substring(0, 100)
        });
      });
    }
    
    // Clean messages before sending
    const cleanedMessages = messages.map(msg => ({
      ...msg,
      content: msg.content ? this.cleanQwen3Content(msg.content) : msg.content,
    }));
    
    // Reset buffer for new conversation
    this.partialBuffer = '';
    this.lastStreamActivity = Date.now();
    
    // Clear any existing timeout
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }
    
    // Use parent's implementation with enhanced cleaning
    let accumulatedContent = '';
    let lastYieldedLength = 0;
    
    try {
      for await (const message of super.generateChatCompletion(cleanedMessages, tools, toolFormat)) {
        // Update activity timestamp
        this.lastStreamActivity = Date.now();
        
        // Handle content messages
        if (message.content !== undefined) {
          // Accumulate content
          accumulatedContent += message.content;
          
          // Clean and yield new content
          const newContent = accumulatedContent.slice(lastYieldedLength);
          const cleaned = this.cleanQwen3Content(newContent);
          
          if (cleaned) {
            yield {
              role: ContentGeneratorRole.ASSISTANT,
              content: cleaned,
            };
            lastYieldedLength = accumulatedContent.length;
          }
        } else {
        // Pass through non-content messages (tool calls, etc.)
        // But check if it's a valid tool call first
        if (message.tool_calls && Array.isArray(message.tool_calls)) {
          // Validate each tool call has required fields
          const validToolCalls = message.tool_calls.filter(tc => 
            tc && tc.function && tc.function.name && tc.function.arguments
          );
          
          if (validToolCalls.length > 0) {
            yield {
              ...message,
              tool_calls: validToolCalls
            };
          }
        } else {
          yield message;
        }
        }
      }
    } catch (error) {
      // Log the error but don't throw - Qwen3 sometimes cuts off mid-stream
      console.error('[Qwen3FireworksProvider] Stream error:', error);
      
      // If we have accumulated content, try to salvage what we can
      if (accumulatedContent && lastYieldedLength < accumulatedContent.length) {
        const remaining = accumulatedContent.slice(lastYieldedLength);
        const cleaned = this.cleanQwen3Content(remaining);
        if (cleaned) {
          yield {
            role: ContentGeneratorRole.ASSISTANT,
            content: cleaned,
          };
        }
      }
    } finally {
      // Clear timeout
      if (this.streamTimeout) {
        clearTimeout(this.streamTimeout);
        this.streamTimeout = null;
      }
    }
    
    // Final cleanup
    if (accumulatedContent && lastYieldedLength < accumulatedContent.length) {
      const finalContent = accumulatedContent.slice(lastYieldedLength);
      const finalCleaned = this.cleanQwen3Content(finalContent);
      if (finalCleaned) {
        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: finalCleaned,
        };
      }
    }
  }

  /**
   * Enhanced Qwen3 content cleaning
   */
  private cleanQwen3Content(content: string): string {
    let cleaned = content;
    
    // Remove Qwen3 control tokens with any role
    cleaned = cleaned.replace(/<\|im_start\|>\w+\n?/g, '');
    cleaned = cleaned.replace(/<\|im_end\|>/g, '');
    
    // Remove special function tokens
    cleaned = cleaned.replace(/<\|reserved_special_token_\d+\|>/g, '');
    
    // Fix missing spaces between words (common Qwen3 issue)
    // This regex looks for lowercase letter followed by uppercase letter with no space
    cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
    
    // Fix common concatenation patterns
    cleaned = cleaned.replace(/(\w)([,.])\s*(\w)/g, '$1$2 $3');
    
    // Keep <think> tags visible by default - useful for debugging
    // cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    // Remove incomplete/truncated tool calls
    // Match tool_call with incomplete JSON or cut off mid-stream
    cleaned = cleaned.replace(/<tool_call>\s*\{[^}]*$/gm, '');
    cleaned = cleaned.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, (match) => {
      // Only keep if it's a complete tool call with closing tag
      if (match.includes('</tool_call>')) {
        return match;
      }
      return '';
    });
    
    // Fix malformed tool calls
    cleaned = cleaned.replace(/<tool_call>\s*{/g, '<tool_call>{');
    cleaned = cleaned.replace(/}\s*<\/tool_call>/g, '}</tool_call>');
    
    // Remove duplicate tool call attempts
    cleaned = cleaned.replace(/(<tool_call>.*?<\/tool_call>)\s*\1/g, '$1');
    
    // Remove tool call JSON fragments that appear outside of tags
    // Pattern: {"name": ... but not within <tool_call> tags
    cleaned = cleaned.replace(/(?<!<tool_call>)\s*\{"name"\s*:\s*"[^"]*"\s*,?\s*"arguments"\s*:\s*\{[^}]*$/gm, '');
    
    // Clean up extra whitespace and newlines
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned.trim();
  }

  /**
   * Override model setting to ensure we use the correct Qwen3 model
   */
  setModel(modelId: string): void {
    // Always use the full Qwen3 model path
    if (!modelId.includes('qwen3')) {
      super.setModel('accounts/fireworks/models/qwen3-235b-a22b');
    } else {
      super.setModel(modelId);
    }
  }

  /**
   * Check if API key is set (required for Fireworks)
   */
  isConfigured(): boolean {
    try {
      // The parent class will throw if no API key
      return true;
    } catch {
      return false;
    }
  }
}