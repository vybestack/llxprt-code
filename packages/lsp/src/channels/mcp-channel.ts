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

import type { Orchestrator } from '../service/orchestrator.js';

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Location = { uri: string; range: Range };
type DocumentSymbol = {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
};
type WorkspaceSymbol = { name: string; kind: number; location: Location };
type Diagnostic = {
  source: string;
  code: string;
  message: string;
  severity: number;
  range: Range;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const getString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

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

const formatLineCol = (position: Position): string =>
  `${position.line + 1}:${position.character + 1}`;

const parsePosition = (value: unknown): Position => {
  if (!isRecord(value)) {
    return { line: 0, character: 0 };
  }
  return {
    line: getNumber(value.line, 0),
    character: getNumber(value.character, 0),
  };
};

const parseRange = (value: unknown): Range => {
  if (!isRecord(value)) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    };
  }
  return {
    start: parsePosition(value.start),
    end: parsePosition(value.end),
  };
};

const parseLocation = (value: unknown): Location => {
  if (!isRecord(value)) {
    return {
      uri: '',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }

  if (typeof value.file === 'string') {
    const line = getNumber(value.line, 0);
    const character = getNumber(value.char, getNumber(value.character, 0));
    return {
      uri: value.file,
      range: {
        start: { line, character },
        end: { line, character },
      },
    };
  }

  return {
    uri: getString(value.uri, ''),
    range: parseRange(value.range),
  };
};

const parseDocumentSymbol = (value: unknown): DocumentSymbol => {
  if (!isRecord(value)) {
    return {
      name: '',
      kind: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }

  const name = getString(value.name, '');
  const kind = getNumber(value.kind, 0);

  if ('selectionRange' in value || 'range' in value) {
    return {
      name,
      kind,
      range: parseRange(value.range),
      selectionRange: parseRange(value.selectionRange ?? value.range),
    };
  }

  const line = getNumber(value.line, 0);
  const character = getNumber(value.char, getNumber(value.character, 0));
  const pos = { line, character };
  return {
    name,
    kind,
    range: { start: pos, end: pos },
    selectionRange: { start: pos, end: pos },
  };
};

const parseWorkspaceSymbol = (value: unknown): WorkspaceSymbol => {
  if (!isRecord(value)) {
    return {
      name: '',
      kind: 0,
      location: {
        uri: '',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
    };
  }

  const name = getString(value.name, '');
  const kind = getNumber(value.kind, 0);

  if (isRecord(value.location)) {
    return {
      name,
      kind,
      location: parseLocation(value.location),
    };
  }

  const line = getNumber(value.line, 0);
  const character = getNumber(value.char, getNumber(value.character, 0));
  return {
    name,
    kind,
    location: {
      uri: getString(value.file, ''),
      range: {
        start: { line, character },
        end: { line, character },
      },
    },
  };
};

const parseDiagnostic = (value: unknown): Diagnostic => {
  if (!isRecord(value)) {
    return {
      source: '',
      code: '',
      message: '',
      severity: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }

  let range = parseRange(value.range);
  if (!('range' in value)) {
    const line = getNumber(value.line, 0);
    const character = getNumber(
      value.column,
      getNumber(value.char, getNumber(value.character, 0)),
    );
    range = {
      start: { line, character },
      end: { line, character },
    };
  }

  return {
    source: getString(value.source, ''),
    code: getString(value.code, ''),
    message: getString(value.message, ''),
    severity: getNumber(value.severity, 0),
    range,
  };
};

const formatLocation = (location: Location, workspaceRoot: string): string => {
  const path = toDisplayPath(location.uri, workspaceRoot);
  return `${path}:${formatLineCol(location.range.start)}`;
};

const formatSymbol = (
  symbol:
    | Pick<DocumentSymbol, 'name' | 'selectionRange'>
    | Pick<WorkspaceSymbol, 'name' | 'location'>,
  workspaceRoot: string,
): string => {
  if ('location' in symbol) {
    return `${symbol.name} - ${formatLocation(symbol.location, workspaceRoot)}`;
  }
  return `${symbol.name} - ${formatLineCol(symbol.selectionRange.start)}`;
};

const formatDiagnostic = (
  filePath: string,
  diagnostic: Diagnostic,
  workspaceRoot: string,
): string => {
  const display = toDisplayPath(filePath, workspaceRoot);
  return `${display}:${formatLineCol(diagnostic.range.start)} ${diagnostic.message}`;
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
  orchestrator: Orchestrator,
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
      const locationsRaw = (await orchestrator.gotoDefinition(
        filePath,
        args.line,
        args.character,
      )) as unknown;
      const locations = Array.isArray(locationsRaw)
        ? locationsRaw.map(parseLocation)
        : [];
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
      const locationsRaw = (await orchestrator.findReferences(
        filePath,
        args.line,
        args.character,
      )) as unknown;
      const locations = Array.isArray(locationsRaw)
        ? locationsRaw.map(parseLocation)
        : [];
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
      const symbolsRaw = (await orchestrator.documentSymbols(
        filePath,
      )) as unknown;
      const symbols = Array.isArray(symbolsRaw)
        ? symbolsRaw.map(parseDocumentSymbol)
        : [];
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
      const symbolsRaw = (await orchestrator.workspaceSymbols(
        args.query,
      )) as unknown;
      const symbols = Array.isArray(symbolsRaw)
        ? symbolsRaw.map(parseWorkspaceSymbol)
        : [];
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
      const allRaw = (await orchestrator.getAllDiagnostics()) as unknown;
      const all = isRecord(allRaw) ? allRaw : {};
      const files = Object.keys(all).sort((a, b) => a.localeCompare(b));
      const lines: string[] = [];
      for (const filePath of files) {
        const diagnosticsRaw = all[filePath];
        const diagnostics = Array.isArray(diagnosticsRaw)
          ? diagnosticsRaw.map(parseDiagnostic)
          : [];
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
