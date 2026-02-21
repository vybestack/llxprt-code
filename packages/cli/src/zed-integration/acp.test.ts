/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { AgentSideConnection, Agent, Client } from './acp.js';
import * as schema from './schema.js';
import { ReadableStream, WritableStream } from 'node:stream/web';

function createReadableStream(messages: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const msg of messages) {
        controller.enqueue(encoder.encode(msg + '\n'));
      }
      controller.close();
    },
  });
}

function createCapturingWritableStream(): {
  stream: WritableStream<Uint8Array>;
  getOutput: () => string;
} {
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  return {
    stream,
    getOutput: () => chunks.map((c) => decoder.decode(c)).join(''),
  };
}

function createMockAgent(): Agent {
  return {
    async initialize(
      _params: schema.InitializeRequest,
    ): Promise<schema.InitializeResponse> {
      return {
        protocolVersion: schema.PROTOCOL_VERSION,
        authMethods: [
          {
            id: 'test',
            name: 'Test Method',
            description: 'Test authentication method',
          },
        ],
        agentCapabilities: {},
      };
    },
    async newSession(
      _params: schema.NewSessionRequest,
    ): Promise<schema.NewSessionResponse> {
      return { sessionId: 'test-session' };
    },
    async authenticate(_params: schema.AuthenticateRequest): Promise<void> {},
    async prompt(
      _params: schema.PromptRequest,
    ): Promise<schema.PromptResponse> {
      return { stopReason: 'end_turn' };
    },
    async cancel(_params: schema.CancelNotification): Promise<void> {},
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('AgentSideConnection', () => {
  it('should send initialize response back to client', async () => {
    const initializeRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: schema.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      },
    });

    const output = createReadableStream([initializeRequest]);
    const { stream: input, getOutput } = createCapturingWritableStream();

    new AgentSideConnection(
      (_client: Client) => createMockAgent(),
      input,
      output,
    );

    await delay(100);

    const responseText = getOutput();
    expect(responseText).toBeTruthy();

    const lines = responseText.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    const response = JSON.parse(lines[0]);
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: schema.PROTOCOL_VERSION,
        authMethods: expect.any(Array),
        agentCapabilities: expect.any(Object),
      },
    });
  });

  it('should send error response for unknown methods', async () => {
    const unknownRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'unknown_method',
      params: {},
    });

    const output = createReadableStream([unknownRequest]);
    const { stream: input, getOutput } = createCapturingWritableStream();

    new AgentSideConnection(
      (_client: Client) => createMockAgent(),
      input,
      output,
    );

    await delay(100);

    const responseText = getOutput();
    expect(responseText).toBeTruthy();

    const lines = responseText.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    const response = JSON.parse(lines[0]);
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32601,
        message: 'Method not found',
      },
    });
  });

  it('should handle invalid JSON without crashing the receive loop', async () => {
    const invalidJson = 'this is not valid json';
    const validRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'initialize',
      params: {
        protocolVersion: schema.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      },
    });

    const output = createReadableStream([invalidJson, validRequest]);
    const { stream: input, getOutput } = createCapturingWritableStream();

    new AgentSideConnection(
      (_client: Client) => createMockAgent(),
      input,
      output,
    );

    await delay(100);

    const responseText = getOutput();
    expect(responseText).toBeTruthy();

    const lines = responseText.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    const response = JSON.parse(lines[0]);
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: expect.any(Object),
    });
  });

  it('should process multiple messages sequentially', async () => {
    const request1 = JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: {
        protocolVersion: schema.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      },
    });

    const request2 = JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/new',
      params: {
        cwd: '/test',
        mcpServers: [],
      },
    });

    const output = createReadableStream([request1, request2]);
    const { stream: input, getOutput } = createCapturingWritableStream();

    new AgentSideConnection(
      (_client: Client) => createMockAgent(),
      input,
      output,
    );

    await delay(100);

    const responseText = getOutput();
    expect(responseText).toBeTruthy();

    const lines = responseText.trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(2);

    const response1 = JSON.parse(lines[0]);
    expect(response1).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: expect.any(Object),
    });

    const response2 = JSON.parse(lines[1]);
    expect(response2).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      result: {
        sessionId: 'test-session',
      },
    });
  });
});
