/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { dumpContext, redactSensitiveData, shouldDump } from './dumpContext.js';

function matchesDumpBaseIdFormat(baseId: string, provider: string): boolean {
  const parts = baseId.split('-');
  if (parts.length < 4) return false;
  const datePart = parts[0];
  const timePart = parts[1];
  const providerPart = parts[2];
  const trailingId = parts.slice(3).join('-');
  if (
    datePart.length !== 8 ||
    !datePart.split('').every((c) => c >= '0' && c <= '9')
  )
    return false;
  if (
    timePart.length !== 6 ||
    !timePart.split('').every((c) => c >= '0' && c <= '9')
  )
    return false;
  if (trailingId.length === 0) return false;
  if (trailingId.endsWith('.json')) return false;
  return providerPart === provider;
}

describe('dumpContext', () => {
  const testDumpDir = path.join(Storage.getGlobalLlxprtDir(), 'dumps');
  const createdFiles: string[] = [];

  beforeEach(async () => {
    // Ensure dump directory exists
    await fs.mkdir(testDumpDir, { recursive: true });
    // Clear the list of created files
    createdFiles.length = 0;
  });

  afterEach(async () => {
    // Clean up test dump files
    try {
      for (const file of createdFiles) {
        try {
          await fs.unlink(path.join(testDumpDir, file));
        } catch {
          // Ignore errors for individual file cleanup
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('shouldDump', () => {
    it('should not let now mode trigger provider dumps', () => {
      expect(shouldDump('now', false)).toBe(false);
      expect(shouldDump('now', true)).toBe(false);
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact Authorization header', () => {
      const request = {
        url: 'https://api.example.com',
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-1234567890abcdef',
          'Content-Type': 'application/json',
        },
        body: { test: 'data' },
      };

      const redacted = redactSensitiveData(request);
      expect(redacted.headers.Authorization).toBe('[REDACTED]');
      expect(redacted.headers['Content-Type']).toBe('application/json');
    });

    it('should redact x-api-key header', () => {
      const request = {
        url: 'https://api.example.com',
        method: 'POST',
        headers: {
          'x-api-key': 'secret-key-12345',
        },
        body: { test: 'data' },
      };

      const redacted = redactSensitiveData(request);
      expect(redacted.headers['x-api-key']).toBe('[REDACTED]');
    });

    it('should redact credential headers case-insensitively', () => {
      const request = {
        url: 'https://api.example.com',
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-lowercase',
          AUTHORIZATION: 'Bearer sk-uppercase',
          'X-API-KEY': 'secret-key-uppercase',
          'Content-Type': 'application/json',
        },
        body: { test: 'data' },
      };

      const redacted = redactSensitiveData(request);

      expect(redacted.headers.authorization).toBe('[REDACTED]');
      expect(redacted.headers.AUTHORIZATION).toBe('[REDACTED]');
      expect(redacted.headers['X-API-KEY']).toBe('[REDACTED]');
      expect(redacted.headers['Content-Type']).toBe('application/json');
    });

    it('should redact key query parameter in URL', () => {
      const request = {
        url: 'https://api.example.com/v1/models?key=AIzaSyABC123',
        method: 'GET',
        headers: {},
        body: null,
      };

      const redacted = redactSensitiveData(request);
      expect(redacted.url).toBe(
        'https://api.example.com/v1/models?key=[REDACTED]',
      );
    });

    it('should preserve non-sensitive headers and URL params', () => {
      const request = {
        url: 'https://api.example.com/v1/models?model=gpt-4&stream=true',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'llxprt/1.0',
        },
        body: { test: 'data' },
      };

      const redacted = redactSensitiveData(request);
      expect(redacted.url).toBe(
        'https://api.example.com/v1/models?model=gpt-4&stream=true',
      );
      expect(redacted.headers['Content-Type']).toBe('application/json');
      expect(redacted.headers['User-Agent']).toBe('llxprt/1.0');
    });

    it('should handle request with no headers', () => {
      const request = {
        url: 'https://api.example.com',
        method: 'GET',
        body: null,
      };

      const redacted = redactSensitiveData(request);
      expect(redacted.url).toBe('https://api.example.com');
      expect(redacted.headers).toBeUndefined();
    });
  });

  describe('dumpContext with OpenAI format', () => {
    it('should create dump file with OpenAI request format', async () => {
      const request = {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test-key',
          'Content-Type': 'application/json',
        },
        body: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.7,
        },
      };

      const response = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hi there!' },
              finish_reason: 'stop',
            },
          ],
        },
      };

      const baseId = await dumpContext(request, response, 'openai');
      const requestFilename = `${baseId}-request.json`;
      const responseFilename = `${baseId}-response.json`;
      createdFiles.push(requestFilename, responseFilename);
      // dumpContext returns a dump base id, not a generated filename.
      expect(baseId.endsWith('.json')).toBe(false);
      expect(matchesDumpBaseIdFormat(baseId, 'openai')).toBe(true);

      const filepath = path.join(testDumpDir, requestFilename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      expect(dump.provider).toBe('openai');
      expect(dump.timestamp).toBeDefined();
      expect(dump.request.url).toBe(request.url);
      expect(dump.request.headers.Authorization).toBe('[REDACTED]');
      expect(dump.request.body.model).toBe('gpt-4');
      expect(dump).not.toHaveProperty('response');

      const responseFilepath = path.join(testDumpDir, responseFilename);
      const responseContent = await fs.readFile(responseFilepath, 'utf-8');
      const responseDump = JSON.parse(responseContent);
      expect(responseDump.provider).toBe('openai');
      expect(responseDump.relatedRequestFile).toBe(requestFilename);
      expect(responseDump).not.toHaveProperty('request');
      expect(responseDump.response.status).toBe(200);
      expect(responseDump.response.body.choices).toHaveLength(1);
    });
  });

  describe('dumpContext with Anthropic format', () => {
    it('should create dump file with Anthropic request format', async () => {
      const request = {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': 'sk-ant-test-key',
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      const response = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi there!' }],
          model: 'claude-3-opus-20240229',
          stop_reason: 'end_turn',
        },
      };

      const baseId = await dumpContext(request, response, 'anthropic');
      const requestFilename = `${baseId}-request.json`;
      const responseFilename = `${baseId}-response.json`;
      createdFiles.push(requestFilename, responseFilename);
      expect(matchesDumpBaseIdFormat(baseId, 'anthropic')).toBe(true);

      const filepath = path.join(testDumpDir, requestFilename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      expect(dump.provider).toBe('anthropic');
      expect(dump.request.headers['x-api-key']).toBe('[REDACTED]');
      expect(dump.request.body.model).toBe('claude-3-opus-20240229');
      await expect(
        fs.access(path.join(testDumpDir, responseFilename)),
      ).resolves.toBeUndefined();
    });
  });

  describe('dumpContext with Gemini format', () => {
    it('should create dump file with Gemini request format', async () => {
      const request = {
        url: 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=AIzaSyABC123',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          contents: [
            {
              role: 'user',
              parts: [{ text: 'Hello' }],
            },
          ],
        },
      };

      const response = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hi there!' }],
              },
              finishReason: 'STOP',
            },
          ],
        },
      };

      const baseId = await dumpContext(request, response, 'gemini');
      const requestFilename = `${baseId}-request.json`;
      const responseFilename = `${baseId}-response.json`;
      createdFiles.push(requestFilename, responseFilename);
      expect(matchesDumpBaseIdFormat(baseId, 'gemini')).toBe(true);

      const filepath = path.join(testDumpDir, requestFilename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      expect(dump.provider).toBe('gemini');
      expect(dump.request.url).toMatch(/key=\[REDACTED\]/);
      expect(dump.request.body.contents).toHaveLength(1);
      await expect(
        fs.access(path.join(testDumpDir, responseFilename)),
      ).resolves.toBeUndefined();
    });
  });

  describe('response handling', () => {
    it('should create related response file when response body is falsy', async () => {
      const request = {
        url: 'https://api.example.com/v1/chat/completions',
        method: 'POST',
        headers: {},
        body: { prompt: 'Return false' },
      };
      const response = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: false,
      };

      const baseId = await dumpContext(request, response, 'openai');
      const requestFilename = `${baseId}-request.json`;
      const responseFilename = `${baseId}-response.json`;
      createdFiles.push(requestFilename, responseFilename);

      const responseContent = await fs.readFile(
        path.join(testDumpDir, responseFilename),
        'utf-8',
      );
      const responseDump = JSON.parse(responseContent);
      expect(responseDump.relatedRequestFile).toBe(requestFilename);
      expect(responseDump.response.body).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle dump directory creation errors gracefully', async () => {
      const request = {
        url: 'https://api.example.com',
        method: 'POST',
        headers: {},
        body: { test: 'data' },
      };

      const response = {
        status: 200,
        headers: {},
        body: { result: 'success' },
      };

      // Should not throw even if there are issues
      const baseId = await dumpContext(request, response, 'openai');
      createdFiles.push(`${baseId}-request.json`, `${baseId}-response.json`);
      expect(baseId).toBeDefined();
    });
  });

  describe('curl compatibility', () => {
    it('should produce curl-compatible JSON for OpenAI', async () => {
      const request = {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer YOUR_API_KEY_HERE',
          'Content-Type': 'application/json',
        },
        body: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test' }],
        },
      };

      const response = {
        status: 200,
        headers: {},
        body: { id: 'test' },
      };

      const baseId = await dumpContext(request, response, 'openai');
      const requestFilename = `${baseId}-request.json`;
      const responseFilename = `${baseId}-response.json`;
      createdFiles.push(requestFilename, responseFilename);
      const filepath = path.join(testDumpDir, requestFilename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      // Verify curl-compatible structure
      expect(dump.request.method).toBe('POST');
      expect(dump.request.url).toBe(request.url);
      expect(dump.request.headers).toBeDefined();
      expect(dump.request.body).toBeDefined();
      expect(typeof dump.request.body).toBe('object');
    });
  });
});
