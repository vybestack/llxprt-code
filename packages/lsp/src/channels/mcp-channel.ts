/**
 * @plan:PLAN-20250212-LSP.P25
 * @requirement REQ-NAV-010
 * @requirement REQ-NAV-030
 * @requirement REQ-NAV-060
 * @pseudocode mcp-channel.md lines 01-203
 */

import { relative, resolve, sep } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type {
  LspDocumentSymbol,
  LspLocation,
  LspWorkspaceSymbol,
} from '../service/lsp-dto.js';
import type { Diagnostic } from '../service/diagnostics.js';

export type McpOrchestrator = {
  gotoDefinition: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<LspLocation[]>;
  findReferences: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<LspLocation[]>;
  hover: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<string | null>;
  documentSymbols: (filePath: string) => Promise<LspDocumentSymbol[]>;
  workspaceSymbols: (query: string) => Promise<LspWorkspaceSymbol[]>;
  getAllDiagnostics: () => Promise<Record<string, Diagnostic[]>>;
};

type TextResult = {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
};

const filePositionSchema = {
  filePath: z.string(),
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
};

const querySchema = {
  query: z.string(),
};

const fileSchema = {
  filePath: z.string(),
};

const toTextResult = (text: string, isError = false): TextResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

const toDisplayPath = (value: string, workspaceRoot: string): string => {
  const filePath = value.startsWith('file://')
    ? decodeURIComponent(value.slice('file://'.length))
    : value;
  const root = resolve(workspaceRoot);
  const abs = resolve(filePath);
  const rel = relative(root, abs).replace(/\\/gu, '/');
  return rel === ''
    ? '.'
    : rel.startsWith('..')
      ? abs.replace(/\\/gu, '/')
      : rel;
};

const formatLineCol = (line: number, character: number): string =>
  `${line + 1}:${character + 1}`;

const formatLocation = (
  location: LspLocation,
  workspaceRoot: string,
): string => {
  const path = toDisplayPath(location.uri, workspaceRoot);
  return `${path}:${formatLineCol(location.range.start.line, location.range.start.character)}`;
};

const formatSymbol = (
  symbol: LspDocumentSymbol | LspWorkspaceSymbol,
  workspaceRoot: string,
): string => {
  if ('location' in symbol) {
    return `${symbol.name} - ${formatLocation(symbol.location, workspaceRoot)}`;
  }
  return `${symbol.name} - ${formatLineCol(symbol.selectionRange.start.line, symbol.selectionRange.start.character)}`;
};

const formatDiagnostic = (
  filePath: string,
  diagnostic: Diagnostic,
  workspaceRoot: string,
): string => {
  const display = toDisplayPath(filePath, workspaceRoot);
  return `${display}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;
};

export const validateFilePath = (
  filePath: string,
  workspaceRoot: string,
): string => {
  const root = resolve(workspaceRoot);
  const normalized = resolve(root, filePath);

  if (normalized === root || normalized.startsWith(`${root}${sep}`)) {
    return normalized;
  }

  throw new Error('File is outside workspace boundary');
};

export async function createMcpChannel(
  orchestrator: McpOrchestrator,
  workspaceRoot: string,
  inputStream: Readable,
  outputStream: Writable,
): Promise<McpServer> {
  const server = new McpServer({
    name: 'lsp-navigation',
    version: '0.1.0',
  });

  server.tool('lsp_goto_definition', filePositionSchema, async (args) => {
    try {
      const filePath = validateFilePath(args.filePath, workspaceRoot);
      const locations = await orchestrator.gotoDefinition(
        filePath,
        args.line,
        args.character,
      );
      const text = locations
        .map((loc) => formatLocation(loc, workspaceRoot))
        .join('\n');
      return toTextResult(text);
    } catch (error) {
      return toTextResult(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });

  server.tool('lsp_find_references', filePositionSchema, async (args) => {
    try {
      const filePath = validateFilePath(args.filePath, workspaceRoot);
      const locations = await orchestrator.findReferences(
        filePath,
        args.line,
        args.character,
      );
      const text = locations
        .map((loc) => formatLocation(loc, workspaceRoot))
        .join('\n');
      return toTextResult(text);
    } catch (error) {
      return toTextResult(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });

  server.tool('lsp_hover', filePositionSchema, async (args) => {
    try {
      const filePath = validateFilePath(args.filePath, workspaceRoot);
      const hover = await orchestrator.hover(
        filePath,
        args.line,
        args.character,
      );
      return toTextResult(hover ?? 'No hover information');
    } catch (error) {
      return toTextResult(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });

  server.tool('lsp_document_symbols', fileSchema, async (args) => {
    try {
      const filePath = validateFilePath(args.filePath, workspaceRoot);
      const symbols = await orchestrator.documentSymbols(filePath);
      const text = symbols
        .map((symbol) => formatSymbol(symbol, workspaceRoot))
        .join('\n');
      return toTextResult(text);
    } catch (error) {
      return toTextResult(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });

  server.tool('lsp_workspace_symbols', querySchema, async (args) => {
    try {
      const symbols = await orchestrator.workspaceSymbols(args.query);
      const text = symbols
        .map((symbol) => formatSymbol(symbol, workspaceRoot))
        .join('\n');
      return toTextResult(text);
    } catch (error) {
      return toTextResult(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });

  server.tool('lsp_diagnostics', async () => {
    try {
      const all = await orchestrator.getAllDiagnostics();
      const files = Object.keys(all).sort((a, b) => a.localeCompare(b));
      const lines: string[] = [];
      for (const filePath of files) {
        const diagnostics = all[filePath];
        for (const diagnostic of diagnostics) {
          lines.push(formatDiagnostic(filePath, diagnostic, workspaceRoot));
        }
      }
      return toTextResult(lines.join('\n'));
    } catch (error) {
      return toTextResult(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });

  const transport = new StdioServerTransport(inputStream, outputStream);
  await server.connect(transport);

  return server;
}
