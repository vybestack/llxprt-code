/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiCompatibleWrapper } from './GeminiCompatibleWrapper.js';
import { IProvider, IMessage, IModel, ITool } from '../IProvider.js';
import {
  GeminiEventType,
  ServerGeminiStreamEvent,
} from '@google/gemini-cli-core';
import { Content, GenerateContentResponse } from '@google/genai';

describe('GeminiCompatibleWrapper', () => {
  let mockProvider: IProvider;
  let wrapper: GeminiCompatibleWrapper;

  beforeEach(() => {
    mockProvider = {
      name: 'test-provider',
      async getModels(): Promise<IModel[]> {
        return [];
      },
      async *generateChatCompletion(
        _messages: IMessage[],
        _tools?: ITool[],
        _toolFormat?: string,
      ): AsyncIterableIterator<IMessage> {
        yield { role: 'assistant', content: 'test response' };
      },
    };
    wrapper = new GeminiCompatibleWrapper(mockProvider);
  });

  describe('generateContent', () => {
    it('should call provider generateChatCompletion and return formatted response', async () => {
      const mockProviderResponse: IMessage[] = [
        { role: 'assistant', content: 'Hello! How can I help you?' },
      ];

      mockProvider.generateChatCompletion = vi
        .fn()
        .mockImplementation(async function* () {
          for (const msg of mockProviderResponse) {
            yield msg;
          }
        });

      const params = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] as Content[],
      };

      const response = await wrapper.generateContent(params);

      expect(mockProvider.generateChatCompletion).toHaveBeenCalledWith([
        {
          role: 'user',
          content: 'Hello',
        },
      ]);

      expect(response).toMatchObject({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello! How can I help you?' }],
            },
          },
        ],
      });
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.generateChatCompletion = vi
        .fn()
        .mockImplementation(async () => {
          throw new Error('Provider error');
        });

      const params = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] as Content[],
      };

      await expect(wrapper.generateContent(params)).rejects.toThrow(
        'Provider error',
      );
    });

    it('should convert tool calls from provider format to Gemini format', async () => {
      const mockProviderResponse: IMessage[] = [
        {
          role: 'assistant',
          content: 'I need to use a tool',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "New York"}',
              },
            },
          ],
        },
      ];

      mockProvider.generateChatCompletion = vi
        .fn()
        .mockImplementation(async function* () {
          for (const msg of mockProviderResponse) {
            yield msg;
          }
        });

      const params = {
        model: 'test-model',
        contents: [
          { role: 'user', parts: [{ text: 'What is the weather?' }] },
        ] as Content[],
      };

      const response = await wrapper.generateContent(params);

      expect(response.candidates?.[0]?.content?.parts).toContainEqual(
        expect.objectContaining({
          functionCall: {
            name: 'get_weather',
            args: { location: 'New York' },
          },
        }),
      );
    });
  });

  describe('generateContentStream', () => {
    it('should stream content from provider as Gemini format', async () => {
      const mockStreamMessages: IMessage[] = [
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: ' world' },
        { role: 'assistant', content: '!' },
      ];

      mockProvider.generateChatCompletion = vi
        .fn()
        .mockImplementation(async function* () {
          for (const msg of mockStreamMessages) {
            yield msg;
          }
        });

      const params = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] as Content[],
      };

      const responses: GenerateContentResponse[] = [];
      for await (const response of wrapper.generateContentStream(params)) {
        responses.push(response);
      }

      expect(responses).toHaveLength(3);
      expect(responses[0].candidates?.[0]?.content?.parts?.[0]).toMatchObject({
        text: 'Hello',
      });
      expect(responses[1].candidates?.[0]?.content?.parts?.[0]).toMatchObject({
        text: ' world',
      });
      expect(responses[2].candidates?.[0]?.content?.parts?.[0]).toMatchObject({
        text: '!',
      });
    });

    it('should handle streaming tool calls', async () => {
      const mockStreamMessages: IMessage[] = [
        { role: 'assistant', content: 'Let me check the weather' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_456',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "Boston"}',
              },
            },
          ],
        },
      ];

      mockProvider.generateChatCompletion = vi
        .fn()
        .mockImplementation(async function* () {
          for (const msg of mockStreamMessages) {
            yield msg;
          }
        });

      const params = {
        model: 'test-model',
        contents: [
          { role: 'user', parts: [{ text: 'Weather in Boston?' }] },
        ] as Content[],
      };

      const responses: GenerateContentResponse[] = [];
      for await (const response of wrapper.generateContentStream(params)) {
        responses.push(response);
      }

      // First response should have text
      expect(responses[0].candidates?.[0]?.content?.parts?.[0]).toMatchObject({
        text: 'Let me check the weather',
      });

      // Second response should have tool call
      expect(responses[1].candidates?.[0]?.content?.parts).toContainEqual(
        expect.objectContaining({
          functionCall: {
            name: 'get_weather',
            args: { location: 'Boston' },
          },
        }),
      );
    });
  });

  describe('adaptStream', () => {
    it('should convert provider message stream to Gemini events', async () => {
      const mockMessages: IMessage[] = [
        { role: 'assistant', content: 'Starting response' },
        { role: 'assistant', content: ' - more content' },
      ];

      async function* mockStream(): AsyncIterableIterator<IMessage> {
        for (const msg of mockMessages) {
          yield msg;
        }
      }

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of wrapper.adaptStream(mockStream())) {
        events.push(event);
      }

      expect(events).toContainEqual(
        expect.objectContaining({
          type: GeminiEventType.Content,
          value: 'Starting response',
        }),
      );

      expect(events).toContainEqual(
        expect.objectContaining({
          type: GeminiEventType.Content,
          value: ' - more content',
        }),
      );
    });

    it('should emit tool call events for provider tool calls', async () => {
      const mockMessages: IMessage[] = [
        {
          role: 'assistant',
          content: 'I will search for that',
          tool_calls: [
            {
              id: 'call_789',
              type: 'function',
              function: {
                name: 'web_search',
                arguments: '{"query": "TypeScript tutorials"}',
              },
            },
          ],
        },
      ];

      async function* mockStream(): AsyncIterableIterator<IMessage> {
        for (const msg of mockMessages) {
          yield msg;
        }
      }

      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of wrapper.adaptStream(mockStream())) {
        events.push(event);
      }

      // Should have content event
      const contentEvent = events.find(
        (e) => e.type === GeminiEventType.Content,
      );
      expect(contentEvent?.value).toBe('I will search for that');

      // Should have tool call event
      const toolEvent = events.find(
        (e) => e.type === GeminiEventType.ToolCallRequest,
      );
      expect(toolEvent).toBeDefined();
      expect(toolEvent?.value).toMatchObject({
        name: 'web_search',
        args: { query: 'TypeScript tutorials' },
      });
    });

    it('should handle errors in the stream', async () => {
      async function* mockStream(): AsyncIterableIterator<IMessage> {
        yield { role: 'assistant', content: 'Starting...' };
        throw new Error('Stream error');
      }

      const events: ServerGeminiStreamEvent[] = [];

      try {
        for await (const event of wrapper.adaptStream(mockStream())) {
          events.push(event);
        }
      } catch (_error) {
        // Expected to throw
      }

      // Should have received the first event before error
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: GeminiEventType.Content,
        value: 'Starting...',
      });
    });
  });

  describe('role mapping', () => {
    it('should map assistant role to model role', async () => {
      mockProvider.generateChatCompletion = vi
        .fn()
        .mockImplementation(async function* () {
          yield { role: 'assistant', content: 'Response from assistant' };
        });

      const params = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] as Content[],
      };

      const response = await wrapper.generateContent(params);

      expect(response.candidates?.[0]?.content?.role).toBe('model');
    });
  });

  describe('content conversion', () => {
    it('should convert Gemini Content format to IMessage format', async () => {
      const generateSpy = vi.fn().mockImplementation(async function* () {
        yield { role: 'assistant', content: 'Test' };
      });
      mockProvider.generateChatCompletion = generateSpy;

      const geminiContents: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ];

      await wrapper.generateContent({
        model: 'test-model',
        contents: geminiContents,
      });

      expect(generateSpy).toHaveBeenCalledWith([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ]);
    });

    it('should handle multi-part messages', async () => {
      const generateSpy = vi.fn().mockImplementation(async function* () {
        yield { role: 'assistant', content: 'Response' };
      });
      mockProvider.generateChatCompletion = generateSpy;

      const geminiContents: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'Part 1' }, { text: ' Part 2' }, { text: ' Part 3' }],
        },
      ];

      await wrapper.generateContent({
        model: 'test-model',
        contents: geminiContents,
      });

      expect(generateSpy).toHaveBeenCalledWith([
        { role: 'user', content: 'Part 1 Part 2 Part 3' },
      ]);
    });
  });
});
