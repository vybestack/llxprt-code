/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { dumpContext, redactSensitiveData } from './dumpContext.js';

describe('dumpContext', () => {
  const testDumpDir = path.join(os.homedir(), '.llxprt', 'dumps');

  beforeEach(async () => {
    // Ensure dump directory exists
    await fs.mkdir(testDumpDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test dump files
    try {
      const files = await fs.readdir(testDumpDir);
      for (const file of files) {
        if (file.startsWith('test-')) {
          await fs.unlink(path.join(testDumpDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
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

      const filename = await dumpContext(request, response, 'openai');
      expect(filename).toMatch(/^\d{8}-\d{6}-openai-\w+\.json$/);

      const filepath = path.join(testDumpDir, filename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      expect(dump.provider).toBe('openai');
      expect(dump.timestamp).toBeDefined();
      expect(dump.request.url).toBe(request.url);
      expect(dump.request.headers.Authorization).toBe('[REDACTED]');
      expect(dump.request.body.model).toBe('gpt-4');
      expect(dump.response.status).toBe(200);
      expect(dump.response.body.choices).toHaveLength(1);
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

      const filename = await dumpContext(request, response, 'anthropic');
      expect(filename).toMatch(/^\d{8}-\d{6}-anthropic-\w+\.json$/);

      const filepath = path.join(testDumpDir, filename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      expect(dump.provider).toBe('anthropic');
      expect(dump.request.headers['x-api-key']).toBe('[REDACTED]');
      expect(dump.request.body.model).toBe('claude-3-opus-20240229');
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

      const filename = await dumpContext(request, response, 'gemini');
      expect(filename).toMatch(/^\d{8}-\d{6}-gemini-\w+\.json$/);

      const filepath = path.join(testDumpDir, filename);
      const content = await fs.readFile(filepath, 'utf-8');
      const dump = JSON.parse(content);

      expect(dump.provider).toBe('gemini');
      expect(dump.request.url).toMatch(/key=\[REDACTED\]/);
      expect(dump.request.body.contents).toHaveLength(1);
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
      const filename = await dumpContext(request, response, 'openai');
      expect(filename).toBeDefined();
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

      const filename = await dumpContext(request, response, 'openai');
      const filepath = path.join(testDumpDir, filename);
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
