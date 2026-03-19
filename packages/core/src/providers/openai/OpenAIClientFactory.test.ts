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

import { describe, it, expect } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import {
  createHttpAgents,
  extractModelParamsFromOptions,
  resolveRuntimeKey,
  instantiateClient,
  mergeInvocationHeaders,
} from './OpenAIClientFactory.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

describe('OpenAIClientFactory', () => {
  describe('createHttpAgents', () => {
    it('returns undefined when no socket settings configured', () => {
      const result = createHttpAgents({});
      expect(result).toBeUndefined();
    });

    it('creates agents with correct timeout when socket-timeout is set', () => {
      const result = createHttpAgents({ 'socket-timeout': 30000 });
      expect(result).toBeDefined();
      expect(result?.httpAgent).toBeInstanceOf(http.Agent);
      expect(result?.httpsAgent).toBeInstanceOf(https.Agent);
      expect((result?.httpAgent as http.Agent).options.timeout).toBe(30000);
      expect((result?.httpsAgent as https.Agent).options.timeout).toBe(30000);
    });

    it('wraps createConnection for TCP_NODELAY when nodelay enabled', () => {
      const result = createHttpAgents({ 'socket-timeout': 60000 });
      expect(result).toBeDefined();
      // Verify HTTP agent's createConnection was wrapped (differs from prototype)
      expect(result?.httpAgent.createConnection).not.toBe(
        http.Agent.prototype.createConnection,
      );
      // Verify HTTPS agent's createConnection was also wrapped
      expect(result?.httpsAgent.createConnection).not.toBe(
        https.Agent.prototype.createConnection,
      );
    });

    it('does not wrap createConnection when socket-nodelay is false', () => {
      const result = createHttpAgents({
        'socket-timeout': 60000,
        'socket-nodelay': false,
      });
      expect(result).toBeDefined();
      // When nodelay is disabled, createConnection should be the original prototype method
      const protoCreate = http.Agent.prototype.createConnection;
      expect(result?.httpAgent.createConnection).toBe(protoCreate);
    });

    it('respects socket-keepalive=false', () => {
      const result = createHttpAgents({
        'socket-timeout': 60000,
        'socket-keepalive': false,
      });
      expect(result).toBeDefined();
      expect((result?.httpAgent as http.Agent).options.keepAlive).toBe(false);
      expect((result?.httpsAgent as https.Agent).options.keepAlive).toBe(false);
    });

    it('uses default timeout when socket-timeout not specified', () => {
      const result = createHttpAgents({ 'socket-keepalive': true });
      expect(result).toBeDefined();
      expect((result?.httpAgent as http.Agent).options.timeout).toBe(60000);
      expect((result?.httpsAgent as https.Agent).options.timeout).toBe(60000);
    });
  });

  describe('extractModelParamsFromOptions', () => {
    it('returns undefined for empty params', () => {
      const options = {
        invocation: { modelParams: {} },
        settings: { get: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = extractModelParamsFromOptions(options);
      expect(result).toBeUndefined();
    });

    it('translates maxOutputTokens to max_tokens', () => {
      const options = {
        invocation: { modelParams: {} },
        settings: { get: (key: string) => (key === 'maxOutputTokens' ? 2000 : undefined) },
      } as unknown as NormalizedGenerateChatOptions;

      const result = extractModelParamsFromOptions(options);
      expect(result).toBeDefined();
      expect(result?.['max_tokens']).toBe(2000);
    });

    it('does not override existing max_tokens', () => {
      const options = {
        invocation: { modelParams: { max_tokens: 1000 } },
        settings: { get: (key: string) => (key === 'maxOutputTokens' ? 2000 : undefined) },
      } as unknown as NormalizedGenerateChatOptions;

      const result = extractModelParamsFromOptions(options);
      expect(result).toBeDefined();
      expect(result?.['max_tokens']).toBe(1000);
    });

    it('includes model params from invocation', () => {
      const options = {
        invocation: { modelParams: { temperature: 0.7, top_p: 0.9 } },
        settings: { get: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = extractModelParamsFromOptions(options);
      expect(result).toBeDefined();
      expect(result?.['temperature']).toBe(0.7);
      expect(result?.['top_p']).toBe(0.9);
    });

    it('ignores invalid maxOutputTokens values', () => {
      const options = {
        invocation: { modelParams: {} },
        settings: { get: (key: string) => (key === 'maxOutputTokens' ? -1 : undefined) },
      } as unknown as NormalizedGenerateChatOptions;

      const result = extractModelParamsFromOptions(options);
      expect(result).toBeUndefined();
    });
  });

  describe('resolveRuntimeKey', () => {
    it('returns runtimeId from runtime context', () => {
      const options = {
        runtime: { runtimeId: 'runtime-123' },
        metadata: {},
        settings: { get: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = resolveRuntimeKey(options);
      expect(result).toBe('runtime-123');
    });

    it('falls back to metadata runtimeId', () => {
      const options = {
        runtime: {},
        metadata: { runtimeId: 'metadata-456' },
        settings: { get: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = resolveRuntimeKey(options);
      expect(result).toBe('metadata-456');
    });

    it('falls back to call-id with prefix', () => {
      const options = {
        runtime: {},
        metadata: {},
        settings: { get: (key: string) => (key === 'call-id' ? 'call-789' : undefined) },
      } as unknown as NormalizedGenerateChatOptions;

      const result = resolveRuntimeKey(options);
      expect(result).toBe('call:call-789');
    });

    it('returns unscoped default when nothing set', () => {
      const options = {
        runtime: {},
        metadata: {},
        settings: { get: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = resolveRuntimeKey(options);
      expect(result).toBe('openai.runtime.unscoped');
    });

    it('trims whitespace from metadata runtimeId', () => {
      const options = {
        runtime: {},
        metadata: { runtimeId: '  trimmed-id  ' },
        settings: { get: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = resolveRuntimeKey(options);
      expect(result).toBe('trimmed-id');
    });
  });

  describe('instantiateClient', () => {
    it('creates client with authToken as apiKey', () => {
      const client = instantiateClient('test-token-123');
      expect(client).toBeDefined();
      expect(client.apiKey).toBe('test-token-123');
    });

    it('sets baseURL when provided', () => {
      const client = instantiateClient('test-token', 'https://custom.api.com/v1');
      expect(client).toBeDefined();
      expect(client.baseURL).toBe('https://custom.api.com/v1');
    });

    it('sets maxRetries to 0', () => {
      const client = instantiateClient('test-token');
      expect(client).toBeDefined();
      expect(client.maxRetries).toBe(0);
    });

    it('applies default headers to client', () => {
      const headers = { 'User-Agent': 'TestAgent/1.0', 'X-Custom': 'value' };
      const client = instantiateClient('test-token', undefined, undefined, headers);
      const opts = (client as unknown as Record<string, unknown>)._options as Record<string, unknown>;
      expect(opts).toBeDefined();
      const dh = opts.defaultHeaders as Record<string, string>;
      expect(dh['User-Agent']).toBe('TestAgent/1.0');
      expect(dh['X-Custom']).toBe('value');
    });

    it('creates client without baseURL when not provided', () => {
      const client = instantiateClient('test-token');
      expect(client).toBeDefined();
      expect(client.baseURL).toBe('https://api.openai.com/v1');
    });

    it('passes HTTP agents through to client options', () => {
      const httpAgent = new http.Agent();
      const httpsAgent = new https.Agent();
      const client = instantiateClient(
        'test-token',
        undefined,
        { httpAgent, httpsAgent },
      );
      const opts = (client as unknown as Record<string, unknown>)._options as Record<string, unknown>;
      expect(opts).toBeDefined();
      expect(opts.httpAgent).toBe(httpAgent);
      expect(opts.httpsAgent).toBe(httpsAgent);
    });

    it('omits defaultHeaders when no headers provided', () => {
      const client = instantiateClient('test-token');
      const opts = (client as unknown as Record<string, unknown>)._options as Record<string, unknown>;
      expect(opts).toBeDefined();
      expect(opts.defaultHeaders).toBeUndefined();
    });
  });

  describe('mergeInvocationHeaders', () => {
    it('returns undefined when no headers', () => {
      const options = {
        invocation: { getEphemeral: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = mergeInvocationHeaders(options);
      expect(result).toBeUndefined();
    });

    it('merges base and invocation headers', () => {
      const options = {
        invocation: {
          getEphemeral: (key: string) =>
            key === 'custom-headers' ? { 'X-Invocation': 'inv-value' } : undefined,
        },
      } as unknown as NormalizedGenerateChatOptions;

      const result = mergeInvocationHeaders(options, { 'X-Base': 'base-value' });
      expect(result).toBeDefined();
      expect(result?.['X-Base']).toBe('base-value');
      expect(result?.['X-Invocation']).toBe('inv-value');
    });

    it('applies User-Agent from ephemeral', () => {
      const options = {
        invocation: {
          getEphemeral: (key: string) =>
            key === 'user-agent' ? 'CustomAgent/2.0' : undefined,
        },
      } as unknown as NormalizedGenerateChatOptions;

      const result = mergeInvocationHeaders(options);
      expect(result).toBeDefined();
      expect(result?.['User-Agent']).toBe('CustomAgent/2.0');
    });

    it('invocation headers override base headers', () => {
      const options = {
        invocation: {
          getEphemeral: (key: string) =>
            key === 'custom-headers' ? { 'X-Shared': 'invocation-value' } : undefined,
        },
      } as unknown as NormalizedGenerateChatOptions;

      const result = mergeInvocationHeaders(options, { 'X-Shared': 'base-value' });
      expect(result).toBeDefined();
      expect(result?.['X-Shared']).toBe('invocation-value');
    });

    it('returns base headers when no invocation headers', () => {
      const options = {
        invocation: { getEphemeral: () => undefined },
      } as unknown as NormalizedGenerateChatOptions;

      const result = mergeInvocationHeaders(options, { 'X-Base': 'base-value' });
      expect(result).toBeDefined();
      expect(result?.['X-Base']).toBe('base-value');
    });

    it('trims whitespace from user-agent', () => {
      const options = {
        invocation: {
          getEphemeral: (key: string) =>
            key === 'user-agent' ? '  TrimmedAgent/1.0  ' : undefined,
        },
      } as unknown as NormalizedGenerateChatOptions;

      const result = mergeInvocationHeaders(options);
      expect(result).toBeDefined();
      expect(result?.['User-Agent']).toBe('TrimmedAgent/1.0');
    });
  });
});
