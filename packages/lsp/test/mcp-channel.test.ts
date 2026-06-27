/**
 * @plan:PLAN-20250212-LSP.P24
 * @requirement REQ-NAV-010
 * @requirement REQ-NAV-030
 * @pseudocode mcp-channel.md lines 01-90
 */

import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  createMcpChannel,
  type McpOrchestrator,
} from '../src/channels/mcp-channel.js';

type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

class LineDelimitedTransport implements Transport {
  private readonly input: PassThrough;
  private readonly output: PassThrough;
  private buffer = '';
  private started = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  constructor(input: PassThrough, output: PassThrough) {
    this.input = input;
    this.output = output;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    this.input.setEncoding('utf8');
    this.input.on('data', (chunk: string) => {
      this.buffer += chunk;
      while (true) {
        const idx = this.buffer.indexOf('\n');
        if (idx === -1) {
          break;
        }

        const raw = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!raw) {
          continue;
        }

        try {
          const parsed = JSON.parse(raw) as unknown;
          this.onmessage?.(parsed);
        } catch (error) {
          this.onerror?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    });

    this.input.on('error', (error) => {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    });

    this.input.on('close', () => {
      this.onclose?.();
    });
  }

  async send(message: unknown): Promise<void> {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    this.output.end();
    this.input.destroy();
    this.onclose?.();
  }
}

function createTransportPair(): {
  clientTransport: Transport;
  serverInput: PassThrough;
  serverOutput: PassThrough;
} {
  const serverToClient = new PassThrough();
  const clientToServer = new PassThrough();

  return {
    clientTransport: new LineDelimitedTransport(serverToClient, clientToServer),
    serverInput: clientToServer,
    serverOutput: serverToClient,
  };
}

async function createHarness(
  orchestrator: McpOrchestrator,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { clientTransport, serverInput, serverOutput } = createTransportPair();
  const server = await createMcpChannel(
    orchestrator,
    '/workspace',
    serverInput,
    serverOutput,
  );

  const client = new Client({ name: 'lsp-mcp-test-client', version: '0.1.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function readText(result: ToolCallResult): string {
  return result.content?.[0]?.text ?? '';
}

describe('MCP channel behavior', () => {
  it('lsp_goto_definition returns formatted single location text', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [
        {
          uri: 'file:///workspace/src/def.ts',
          range: {
            start: { line: 4, character: 2 },
            end: { line: 4, character: 10 },
          },
        },
      ],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_goto_definition',
      arguments: { filePath: 'src/main.ts', line: 5, character: 3 },
    })) as ToolCallResult;

    expect(result.isError).not.toBe(true);
    expect(readText(result)).toContain('src/def.ts:5:3');

    await harness.close();
  });

  it('lsp_goto_definition returns multiple formatted locations', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [
        {
          uri: 'file:///workspace/src/a.ts',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
        {
          uri: 'file:///workspace/src/b.ts',
          range: {
            start: { line: 10, character: 6 },
            end: { line: 10, character: 9 },
          },
        },
      ],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_goto_definition',
      arguments: { filePath: './src/main.ts', line: 1, character: 1 },
    })) as ToolCallResult;

    expect(readText(result)).toContain('src/a.ts:1:1');
    expect(readText(result)).toContain('src/b.ts:11:7');

    await harness.close();
  });

  it('lsp_goto_definition rejects ../ traversal outside workspace boundary', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_goto_definition',
      arguments: { filePath: '../../etc/passwd', line: 1, character: 1 },
    })) as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(readText(result)).toContain('File is outside workspace boundary');

    await harness.close();
  });

  it('lsp_find_references returns formatted locations', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [
        {
          uri: 'file:///workspace/src/ref1.ts',
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 8 },
          },
        },
        {
          uri: 'file:///workspace/src/ref2.ts',
          range: {
            start: { line: 7, character: 0 },
            end: { line: 7, character: 2 },
          },
        },
      ],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_find_references',
      arguments: { filePath: 'src/main.ts', line: 3, character: 5 },
    })) as ToolCallResult;

    expect(readText(result)).toContain('src/ref1.ts:3:5');
    expect(readText(result)).toContain('src/ref2.ts:8:1');

    await harness.close();
  });

  it('lsp_find_references rejects external absolute path', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_find_references',
      arguments: { filePath: '/etc/hosts', line: 1, character: 1 },
    })) as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(readText(result)).toContain('File is outside workspace boundary');

    await harness.close();
  });

  it('lsp_hover returns hover text from orchestrator', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => 'const value: string',
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_hover',
      arguments: { filePath: 'src/main.ts', line: 2, character: 7 },
    })) as ToolCallResult;

    expect(readText(result)).toContain('const value: string');

    await harness.close();
  });

  it('lsp_hover returns no-info text when orchestrator returns null', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_hover',
      arguments: { filePath: './src/main.ts', line: 1, character: 1 },
    })) as ToolCallResult;

    expect(readText(result)).toContain('No hover information');

    await harness.close();
  });

  it('lsp_document_symbols returns formatted symbol list', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [
        {
          name: 'runTask',
          kind: 12,
          range: {
            start: { line: 20, character: 0 },
            end: { line: 30, character: 1 },
          },
          selectionRange: {
            start: { line: 20, character: 9 },
            end: { line: 20, character: 16 },
          },
        },
      ],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_document_symbols',
      arguments: { filePath: 'src/main.ts' },
    })) as ToolCallResult;

    expect(readText(result)).toContain('runTask');
    expect(readText(result)).toContain('21:1');

    await harness.close();
  });

  it('lsp_document_symbols rejects workspace escape path', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_document_symbols',
      arguments: { filePath: '../outside.ts' },
    })) as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(readText(result)).toContain('File is outside workspace boundary');

    await harness.close();
  });

  it('lsp_workspace_symbols returns formatted workspace symbol matches', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [
        {
          name: 'buildProject',
          kind: 12,
          location: {
            uri: 'file:///workspace/src/build.ts',
            range: {
              start: { line: 9, character: 2 },
              end: { line: 11, character: 1 },
            },
          },
        },
      ],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_workspace_symbols',
      arguments: { query: 'build' },
    })) as ToolCallResult;

    expect(readText(result)).toContain('buildProject');
    expect(readText(result)).toContain('src/build.ts:10:3');

    await harness.close();
  });

  it('lsp_diagnostics returns formatted diagnostics ordered by file path', async () => {
    const harness = await createHarness({
      gotoDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({
        '/workspace/src/z.ts': [
          {
            file: 'src/z.ts',
            message: 'z issue',
            severity: 'warning',
            line: 2,
            column: 1,
            code: 'TS2',
          },
        ],
        '/workspace/src/a.ts': [
          {
            file: 'src/a.ts',
            message: 'a issue',
            severity: 'error',
            line: 1,
            column: 2,
            code: 'TS1',
          },
        ],
      }),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_diagnostics',
      arguments: {},
    })) as ToolCallResult;

    const text = readText(result);
    const aIndex = text.indexOf('src/a.ts');
    const zIndex = text.indexOf('src/z.ts');
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(zIndex).toBeGreaterThan(aIndex);
    expect(text).toContain('a issue');
    expect(text).toContain('z issue');
    expect(text).toContain('src/a.ts:1:2');
    expect(text).toContain('src/z.ts:2:1');

    await harness.close();
  });

  it('path normalization resolves ./ segments for in-workspace file paths', async () => {
    const harness = await createHarness({
      gotoDefinition: async (filePath) => [
        {
          uri: `file://${filePath.replace(/\\/gu, '/')}`,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
      findReferences: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
      workspaceSymbols: async () => [],
      getAllDiagnostics: async () => ({}),
    });

    const result = (await harness.client.callTool({
      name: 'lsp_goto_definition',
      arguments: { filePath: 'src/./nested/./item.ts', line: 1, character: 1 },
    })) as ToolCallResult;

    expect(readText(result)).toContain('src/nested/item.ts:1:1');

    await harness.close();
  });
});
