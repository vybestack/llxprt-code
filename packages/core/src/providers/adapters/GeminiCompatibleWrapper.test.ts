/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, Mock } from 'vitest';
import { GeminiCompatibleWrapper } from './GeminiCompatibleWrapper.js';
import type { IProvider as Provider } from '../IProvider.js';
import { Type, Tool } from '@google/genai';

describe('GeminiCompatibleWrapper', () => {
  describe('convertGeminiToolsToProviderTools', () => {
    it('should convert Type enum values to lowercase strings', async () => {
      // Create a mock provider
      const mockProvider: Provider = {
        name: 'test-provider',
        getCurrentModel: () => 'test-model',
        setModel: vi.fn(),
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            role: 'assistant',
            content: 'Test response',
          };
        }),
        getServerTools: () => [],
        invokeServerTool: vi
          .fn()
          .mockRejectedValue(new Error('Server tools not supported')),
      };

      const wrapper = new GeminiCompatibleWrapper(mockProvider);

      // Test tools with Type enum values
      const geminiTools = [
        {
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  stringParam: {
                    type: Type.STRING,
                    description: 'A string parameter',
                  },
                  numberParam: {
                    type: Type.NUMBER,
                    description: 'A number parameter',
                  },
                  booleanParam: {
                    type: Type.BOOLEAN,
                    description: 'A boolean parameter',
                  },
                  arrayParam: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING,
                    },
                    description: 'An array parameter',
                  },
                  objectParam: {
                    type: Type.OBJECT,
                    properties: {
                      nestedString: {
                        type: Type.STRING,
                      },
                    },
                    description: 'An object parameter',
                  },
                },
                required: ['stringParam'],
              },
            },
          ],
        },
      ];

      // Generate content with tools
      const generator = wrapper.generateContentStream({
        model: 'test-model',
        contents: 'Test prompt',
        config: {
          tools: geminiTools as Tool[],
        },
      });

      // Consume the generator
      const results = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Check that generateChatCompletion was called with converted tools
      expect(mockProvider.generateChatCompletion).toHaveBeenCalled();
      const [_messages, tools] = (mockProvider.generateChatCompletion as Mock)
        .mock.calls[0];

      // Verify tools were converted correctly
      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      expect(tools[0].function.parameters.type).toBe('object'); // Should be lowercase
      expect(tools[0].function.parameters.properties.stringParam.type).toBe(
        'string',
      ); // Should be lowercase
      expect(tools[0].function.parameters.properties.numberParam.type).toBe(
        'number',
      ); // Should be lowercase
      expect(tools[0].function.parameters.properties.booleanParam.type).toBe(
        'boolean',
      ); // Should be lowercase
      expect(tools[0].function.parameters.properties.arrayParam.type).toBe(
        'array',
      ); // Should be lowercase
      expect(
        tools[0].function.parameters.properties.arrayParam.items.type,
      ).toBe('string'); // Should be lowercase
      expect(tools[0].function.parameters.properties.objectParam.type).toBe(
        'object',
      ); // Should be lowercase
      expect(
        tools[0].function.parameters.properties.objectParam.properties
          .nestedString.type,
      ).toBe('string'); // Should be lowercase
    });

    it('should handle tools without Type enum values', async () => {
      // Create a mock provider
      const mockProvider: Provider = {
        name: 'test-provider',
        getCurrentModel: () => 'test-model',
        setModel: vi.fn(),
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            role: 'assistant',
            content: 'Test response',
          };
        }),
        getServerTools: () => [],
        invokeServerTool: vi
          .fn()
          .mockRejectedValue(new Error('Server tools not supported')),
      };

      const wrapper = new GeminiCompatibleWrapper(mockProvider);

      // Test tools with plain string types (already lowercase)
      const geminiTools = [
        {
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: {
                  stringParam: {
                    type: 'string',
                    description: 'A string parameter',
                  },
                },
                required: ['stringParam'],
              },
            },
          ],
        },
      ];

      // Generate content with tools
      const generator = wrapper.generateContentStream({
        model: 'test-model',
        contents: 'Test prompt',
        config: {
          tools: geminiTools as Tool[],
        },
      });

      // Consume the generator
      const results = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Check that generateChatCompletion was called with tools unchanged
      expect(mockProvider.generateChatCompletion).toHaveBeenCalled();
      const [_messages, tools] = (mockProvider.generateChatCompletion as Mock)
        .mock.calls[0];

      // Verify tools remain unchanged
      expect(tools).toBeDefined();
      expect(tools.length).toBe(1);
      expect(tools[0].function.parameters.type).toBe('object'); // Should remain lowercase
      expect(tools[0].function.parameters.properties.stringParam.type).toBe(
        'string',
      ); // Should remain lowercase
    });
  });

  describe('PDF handling in tool responses', () => {
    it('should extract PDF content from tool responses and add as user message', () => {
      const mockProvider: Provider = {
        name: 'gemini', // Set to gemini for PDF parts test
        getCurrentModel: () => 'test-model',
        setModel: vi.fn(),
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn(),
        getServerTools: () => [],
        invokeServerTool: vi
          .fn()
          .mockRejectedValue(new Error('Server tools not supported')),
      };

      const wrapper = new GeminiCompatibleWrapper(mockProvider);

      // Test content with both functionResponse and PDF inlineData
      const contents = [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'test-call-123',
                name: 'read_file',
                response: {
                  output:
                    'Binary content of type application/pdf was processed.',
                },
              },
            },
            {
              inlineData: {
                data: 'base64PDFDataHere',
                mimeType: 'application/pdf',
              },
            },
          ],
        },
      ];

      // Convert to messages using the private method (we'll test through the wrapper)
      const messages = (
        wrapper as unknown as {
          convertContentsToMessages: (contents: unknown) => unknown[];
        }
      ).convertContentsToMessages(contents);

      // Should have 2 messages: one for the tool response, one for the PDF
      expect(messages).toHaveLength(2);

      // First message should be the tool response
      expect(messages[0]).toEqual({
        role: 'tool',
        content: 'Binary content of type application/pdf was processed.',
        tool_call_id: 'test-call-123',
        name: 'read_file',
      });

      // Second message should be a user message with the PDF part
      expect(messages[1]).toEqual({
        role: 'user',
        content: '',
        parts: [
          {
            inlineData: {
              data: 'base64PDFDataHere',
              mimeType: 'application/pdf',
            },
          },
        ],
      });
    });

    it('should handle tool responses without additional parts normally', () => {
      const mockProvider: Provider = {
        name: 'test-provider',
        getCurrentModel: () => 'test-model',
        setModel: vi.fn(),
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn(),
        getServerTools: () => [],
        invokeServerTool: vi
          .fn()
          .mockRejectedValue(new Error('Server tools not supported')),
      };

      const wrapper = new GeminiCompatibleWrapper(mockProvider);

      // Test content with only functionResponse
      const contents = [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'test-call-456',
                name: 'list_files',
                response: {
                  output: 'file1.txt\nfile2.txt',
                },
              },
            },
          ],
        },
      ];

      const messages = (
        wrapper as unknown as {
          convertContentsToMessages: (contents: unknown) => unknown[];
        }
      ).convertContentsToMessages(contents);

      // Should have only 1 message for the tool response
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: 'tool',
        content: 'file1.txt\nfile2.txt',
        tool_call_id: 'test-call-456',
        name: 'list_files',
      });
    });
  });
});
