/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  dumpRequestContext,
  dumpResponseContext,
  generateDumpBaseId,
} from './dumpContext.js';

// Set a test-specific config home before any Storage call so
// getGlobalLlxprtDir resolves inside the sandbox, not the real user dir.
const TEST_CONFIG_HOME = path.join(
  os.tmpdir(),
  `llxprt-dumpctx-test-${process.pid}`,
);
process.env['LLXPRT_CONFIG_HOME'] = TEST_CONFIG_HOME;

const DUMP_DIR = path.join(Storage.getGlobalLlxprtDir(), 'dumps');

describe('dumpContext separate request/response files', () => {
  const createdFiles: string[] = [];

  afterEach(async () => {
    for (const file of createdFiles) {
      try {
        await fs.unlink(file);
      } catch {
        // best effort cleanup
      }
    }
    createdFiles.length = 0;
  });

  describe('generateDumpBaseId', () => {
    it('should produce a deterministic date-prefixed string with random suffix', () => {
      const id = generateDumpBaseId('anthropic');
      const [date, time, provider, suffix] = id.split('-');
      expect(date).toHaveLength(8);
      expect(Number.isInteger(Number(date))).toBe(true);
      expect(time).toHaveLength(6);
      expect(Number.isInteger(Number(time))).toBe(true);
      expect(provider).toBe('anthropic');
      expect(suffix).toBeTruthy();
    });

    it('should produce unique ids on successive calls', () => {
      const id1 = generateDumpBaseId('gemini');
      const id2 = generateDumpBaseId('gemini');
      expect(id1).not.toBe(id2);
    });
  });

  describe('dumpRequestContext', () => {
    it('should write a request-only file with -request.json suffix', async () => {
      const request = {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        body: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      };
      const result = await dumpRequestContext(request, 'anthropic');
      expect(result.baseId).toBeTruthy();
      expect(result.requestFilename).toMatch(/-request\.json$/);
      expect(result.dumpDir).toBe(DUMP_DIR);

      const filepath = path.join(DUMP_DIR, result.requestFilename);
      createdFiles.push(filepath);

      const content = JSON.parse(await fs.readFile(filepath, 'utf-8'));
      expect(content.provider).toBe('anthropic');
      expect(content.timestamp).toBeTruthy();
      expect(content.request.url).toBe(request.url);
      expect(content.request.method).toBe('POST');
      expect(content.request.body).toStrictEqual(request.body);
      expect(content).not.toHaveProperty('response');
    });

    it('should redact sensitive headers in request', async () => {
      const request = {
        url: 'https://api.openai.com/v1/chat/completions?key=secret',
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-secret',
          'x-api-key': 'secret-key',
        },
        body: {},
      };
      const result = await dumpRequestContext(request, 'openai');
      const filepath = path.join(DUMP_DIR, result.requestFilename);
      createdFiles.push(filepath);

      const content = JSON.parse(await fs.readFile(filepath, 'utf-8'));
      expect(content.request.headers.Authorization).toBe('[REDACTED]');
      expect(content.request.headers['x-api-key']).toBe('[REDACTED]');
      expect(content.request.url).toContain('key=[REDACTED]');
    });
  });

  describe('dumpResponseContext', () => {
    it('should write a response file related to a given request base id', async () => {
      const request = {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        body: {},
      };
      const reqResult = await dumpRequestContext(request, 'anthropic');
      const reqFilepath = path.join(DUMP_DIR, reqResult.requestFilename);
      createdFiles.push(reqFilepath);

      const response = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { id: 'msg_test', content: [{ type: 'text', text: 'Hi' }] },
      };

      const respResult = await dumpResponseContext(
        reqResult.baseId,
        response,
        'anthropic',
      );
      expect(respResult.responseFilename).toMatch(/-response\.json$/);
      expect(respResult.responseFilename).toContain(reqResult.baseId);

      const respFilepath = path.join(DUMP_DIR, respResult.responseFilename);
      createdFiles.push(respFilepath);

      const content = JSON.parse(await fs.readFile(respFilepath, 'utf-8'));
      expect(content.provider).toBe('anthropic');
      expect(content.timestamp).toBeTruthy();
      expect(content).not.toHaveProperty('request');
      expect(content.response.status).toBe(200);
      expect(content.response.body).toStrictEqual(response.body);
      expect(content.relatedRequestFile).toBe(reqResult.requestFilename);
    });

    it('should write a response file for an error', async () => {
      const baseId = generateDumpBaseId('gemini');
      const response = {
        status: 500,
        body: { error: 'Rate limit exceeded' },
      };

      const respResult = await dumpResponseContext(baseId, response, 'gemini');
      const respFilepath = path.join(DUMP_DIR, respResult.responseFilename);
      createdFiles.push(respFilepath);

      const content = JSON.parse(await fs.readFile(respFilepath, 'utf-8'));
      expect(content.response.status).toBe(500);
      expect(content.response.body.error).toBe('Rate limit exceeded');
      expect(content.relatedRequestFile).toBe(`${baseId}-request.json`);
    });
  });

  describe('request and response files are related by base id', () => {
    it('should produce filenames sharing the same base id', async () => {
      const request = {
        url: 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent',
        method: 'POST',
        body: { contents: [] },
      };
      const reqResult = await dumpRequestContext(request, 'gemini');
      const reqFilepath = path.join(DUMP_DIR, reqResult.requestFilename);
      createdFiles.push(reqFilepath);

      const response = { status: 200, body: { candidates: [] } };
      const respResult = await dumpResponseContext(
        reqResult.baseId,
        response,
        'gemini',
      );
      const respFilepath = path.join(DUMP_DIR, respResult.responseFilename);
      createdFiles.push(respFilepath);

      expect(reqResult.requestFilename).toBe(
        `${reqResult.baseId}-request.json`,
      );
      expect(respResult.responseFilename).toBe(
        `${reqResult.baseId}-response.json`,
      );
      expect(respResult.responseFilename).toContain(reqResult.baseId);
    });
  });
});
