/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeAnthropicApiCall } from './AnthropicApiExecution.js';
import * as dumpSDKContextModule from '../utils/dumpSDKContext.js';
import type Anthropic from '@anthropic-ai/sdk';

describe('executeAnthropicApiCall dumpContext behavior', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  const requestBody: Record<string, unknown> = {
    model: 'claude-sonnet-4-5-20250929',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const baseURL = 'https://api.anthropic.com';

  const rateLimitLogger = { debug: vi.fn() };

  beforeEach(() => {
    vi.restoreAllMocks();

    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-anthropic-test12',
      requestFilename: '20260101-120000-anthropic-test12-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-anthropic-test12-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');
    dumpSDKContextSpy.mockResolvedValue('dump-file.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on mode - pre-request dump before API call', () => {
    it('should write request dump file BEFORE the API call is made', async () => {
      const callOrder: string[] = [];

      dumpSDKRequestContextSpy.mockImplementation(async () => {
        callOrder.push('dumpSDKRequestContext');
        return {
          baseId: 'base-123',
          requestFilename: 'base-123-request.json',
          dumpDir: '/tmp/.llxprt/dumps',
        };
      });

      const apiCallFn = vi.fn(async () => {
        callOrder.push('apiCall');
        return {
          data: {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-5-20250929',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          } as unknown as Anthropic.Message,
          response: undefined,
        };
      });

      await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'on',
        baseURL,
        requestBody,
        streamingEnabled: false,
        rateLimitLogger,
      });

      expect(callOrder[0]).toBe('dumpSDKRequestContext');
      expect(callOrder[1]).toBe('apiCall');
    });

    it('should write linked response dump file after successful non-streaming call', async () => {
      const apiCallFn = vi.fn(async () => ({
        data: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-5-20250929',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as Anthropic.Message,
        response: undefined,
      }));

      await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'on',
        baseURL,
        requestBody,
        streamingEnabled: false,
        rateLimitLogger,
      });

      expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
      expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();

      const [baseId] = dumpSDKResponseContextSpy.mock.calls[0];
      expect(baseId).toBe('20260101-120000-anthropic-test12');
    });
  });

  describe('on mode - streaming response accumulation', () => {
    it('should wrap the stream, pass chunks through unchanged, and write linked response after stream completes', async () => {
      const events: Anthropic.MessageStreamEvent[] = [
        {
          type: 'message_start',
          message: {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5-20250929',
            content: [],
            stop_reason: null,
            usage: {
              input_tokens: 10,
              output_tokens: 0,
            },
          },
        } as unknown as Anthropic.MessageStreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        } as unknown as Anthropic.MessageStreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' world' },
        } as unknown as Anthropic.MessageStreamEvent,
        {
          type: 'message_stop',
        } as unknown as Anthropic.MessageStreamEvent,
      ];

      const originalStream: AsyncIterable<Anthropic.MessageStreamEvent> = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };

      const apiCallFn = vi.fn(async () => ({
        data: originalStream as unknown as AsyncIterable<Anthropic.MessageStreamEvent>,
        response: undefined,
      }));

      const result = await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'on',
        baseURL,
        requestBody,
        streamingEnabled: true,
        rateLimitLogger,
      });

      const stream =
        result.response as AsyncIterable<Anthropic.MessageStreamEvent>;

      const received: Anthropic.MessageStreamEvent[] = [];
      for await (const chunk of stream) {
        received.push(chunk);
      }

      expect(received).toHaveLength(events.length);
      expect(received).toStrictEqual(events);

      expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
      const [baseId, , responseBody, isError] =
        dumpSDKResponseContextSpy.mock.calls[0];
      expect(baseId).toBe('20260101-120000-anthropic-test12');
      expect(isError).toBe(false);
      expect(responseBody).toStrictEqual({
        streaming: true,
        chunks: events,
        completed: true,
      });
    });

    it('should write response dump with accumulated chunks even if stream yields zero chunks', async () => {
      const originalStream: AsyncIterable<Anthropic.MessageStreamEvent> = {
        async *[Symbol.asyncIterator]() {
          // Empty stream
        },
      };

      const apiCallFn = vi.fn(async () => ({
        data: originalStream as unknown as AsyncIterable<Anthropic.MessageStreamEvent>,
        response: undefined,
      }));

      const result = await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'on',
        baseURL,
        requestBody,
        streamingEnabled: true,
        rateLimitLogger,
      });

      const stream =
        result.response as AsyncIterable<Anthropic.MessageStreamEvent>;
      for await (const _chunk of stream) {
        void _chunk;
      }

      expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
      const [, , responseBody] = dumpSDKResponseContextSpy.mock.calls[0];
      expect(responseBody).toStrictEqual({
        streaming: true,
        chunks: [],
        completed: true,
      });
    });

    it('should write response dump after stream completes even if iteration errors', async () => {
      const originalStream: AsyncIterable<Anthropic.MessageStreamEvent> = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'partial' },
          } as unknown as Anthropic.MessageStreamEvent;
          throw new Error('Stream interrupted');
        },
      };

      const apiCallFn = vi.fn(async () => ({
        data: originalStream as unknown as AsyncIterable<Anthropic.MessageStreamEvent>,
        response: undefined,
      }));

      const result = await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'on',
        baseURL,
        requestBody,
        streamingEnabled: true,
        rateLimitLogger,
      });

      const stream =
        result.response as AsyncIterable<Anthropic.MessageStreamEvent>;

      const received: Anthropic.MessageStreamEvent[] = [];
      await expect(async () => {
        for await (const chunk of stream) {
          received.push(chunk);
        }
      }).rejects.toThrow('Stream interrupted');

      expect(received).toHaveLength(1);
      // Response dump should still be written with accumulated chunks
      expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
      const [, , responseBody, isError] =
        dumpSDKResponseContextSpy.mock.calls[0];
      expect(responseBody).toMatchObject({
        streaming: true,
        chunks: expect.arrayContaining(received),
        error: 'Error: Stream interrupted',
      });
      expect(isError).toBe(true);
    });
  });

  describe('error mode - no pre-dump on success, dump after error', () => {
    it('should NOT write request dump when error mode and API call succeeds', async () => {
      const apiCallFn = vi.fn(async () => ({
        data: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-5-20250929',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as Anthropic.Message,
        response: undefined,
      }));

      await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'error',
        baseURL,
        requestBody,
        streamingEnabled: false,
        rateLimitLogger,
      });

      expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
      expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
      expect(dumpSDKContextSpy).not.toHaveBeenCalled();
    });

    it('should dump after error with linked request/response when error mode', async () => {
      const apiCallFn = vi.fn(async () => {
        throw new Error('API Error: Rate limit exceeded');
      });

      await expect(
        executeAnthropicApiCall({
          apiCallFn,
          dumpMode: 'error',
          baseURL,
          requestBody,
          streamingEnabled: false,
          rateLimitLogger,
        }),
      ).rejects.toThrow('API Error');

      expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
      expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
        '20260101-120000-anthropic-test12',
        'anthropic',
        { error: 'API Error: Rate limit exceeded' },
        true,
      );
      expect(dumpSDKContextSpy).not.toHaveBeenCalled();
    });
  });

  describe('off mode - no dumps', () => {
    it('should not write any dump files when mode is off', async () => {
      const apiCallFn = vi.fn(async () => ({
        data: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-5-20250929',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as Anthropic.Message,
        response: undefined,
      }));

      await executeAnthropicApiCall({
        apiCallFn,
        dumpMode: 'off',
        baseURL,
        requestBody,
        streamingEnabled: false,
        rateLimitLogger,
      });

      expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
      expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
      expect(dumpSDKContextSpy).not.toHaveBeenCalled();
    });
  });
});
