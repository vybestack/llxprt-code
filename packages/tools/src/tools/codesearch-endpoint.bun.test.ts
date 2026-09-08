/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the codesearch Exa MCP endpoint (issue #3038, AC7).
 *
 * The tool posts to the fixed production https://mcp.exa.ai/mcp origin. A
 * temporary URL router in front of the saved real native fetch rewrites only that
 * origin to a real local loopback server; the server observes and produces all
 * network data. Nothing fabricates a Response, status line, or expected value.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CodeSearchTool } from './codesearch.js';
import { ToolErrorType } from '../types/tool-error.js';
import {
  collectRequestBody,
  createKeyStorage,
  createLoopbackHarness,
} from '../test-utils/loopback-test-helpers.js';

const loopback = createLoopbackHarness('https://mcp.exa.ai');

describe('codesearch Exa MCP endpoint (issue #3038, AC7)', () => {
  let tool: InstanceType<typeof CodeSearchTool>;

  beforeEach(() => {
    tool = new CodeSearchTool({ keyStorage: createKeyStorage() });
  });

  it('formats a top-level error with missing fields without interpolating undefined', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('data: {"error":{},"jsonrpc":"2.0","id":1}\n');
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'missing error fields' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.error?.message).toContain('unknown');
    expect(result.error?.message).toContain('no message provided');
    expect(result.error?.message).not.toContain('undefined');
  });

  it('returns SEARCH_ERROR when isError has no content', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('data: {"result":{"isError":true},"jsonrpc":"2.0","id":1}\n');
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'missing error content' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.error?.message).toContain('no message');
  });

  it('returns SEARCH_ERROR for an upstream isError result', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        'data: {"result":{"content":[{"type":"text","text":"MCP error -32602: Tool get_code_context_exa not found"}],"isError":true},"jsonrpc":"2.0","id":1}\n',
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'broken query' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.llmContent).toContain('get_code_context_exa');
  });

  it('returns SEARCH_ERROR for a top-level JSON-RPC error object', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        'data: {"error":{"code":-32602,"message":"Invalid params"},"jsonrpc":"2.0","id":1}\n',
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'bad query' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
  });

  it('sanitizes unpaired surrogates in upstream error text', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        'data: {"result":{"content":[{"type":"text","text":"\\ud800 broken"}],"isError":true},"jsonrpc":"2.0","id":1}\n',
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'surrogate test' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    const SURROGATE = String.fromCharCode(0xd800);
    expect(result.llmContent).not.toContain(SURROGATE);
    expect(result.error?.message).not.toContain(SURROGATE);
  });
});
