/* @plan PLAN-20250212-LSP.P10 */

import { createInterface } from 'node:readline';

type Severity = 1 | 2 | 3 | 4;

type Diagnostic = {
  message: string;
  severity: Severity;
  code?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: unknown[];
};

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
};

type FakeServerMode = {
  delayMs?: number;
  crashOnDidOpen?: boolean;
  crashOnDidChange?: boolean;
  delayRequestMethods?: Set<string>;
  crashOnMethod?: string;
  delayRespondMs?: number;
};

const mode: FakeServerMode = parseMode(process.argv.slice(2));
const documents = new Map<string, string>();
let initialized = false;

function parseMode(args: string[]): FakeServerMode {
  const parsed: FakeServerMode = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--delay-ms') {
      const raw = args[i + 1];
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) {
        parsed.delayMs = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--delay-request-method') {
      const methodValue = args[i + 1];
      if (typeof methodValue === 'string' && methodValue.length > 0) {
        if (!parsed.delayRequestMethods) {
          parsed.delayRequestMethods = new Set();
        }
        parsed.delayRequestMethods.add(methodValue);
      }
      i += 1;
      continue;
    }

    if (arg === '--crash-on-did-open') {
      parsed.crashOnDidOpen = true;
      continue;
    }

    if (arg === '--crash-on-did-change') {
      parsed.crashOnDidChange = true;
      continue;
    }

    if (arg === '--no-definition-response') {
      if (!parsed.delayRequestMethods) {
        parsed.delayRequestMethods = new Set();
      }
      parsed.delayRequestMethods.add('textDocument/definition');
      continue;
    }

    if (arg === '--crash-on-method') {
      const methodValue = args[i + 1];
      if (typeof methodValue === 'string' && methodValue.length > 0) {
        parsed.crashOnMethod = methodValue;
      }
      i += 1;
      continue;
    }

    if (arg === '--delay-respond-ms') {
      const raw = args[i + 1];
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) {
        parsed.delayRespondMs = value;
      }
      i += 1;
      continue;
    }
  }

  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function sendPublishDiagnostics(
  params: PublishDiagnosticsParams,
): Promise<void> {
  if (mode.delayMs && mode.delayMs > 0) {
    await sleep(mode.delayMs);
  }

  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params,
  });
}

function createDiagnosticsForText(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = text.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (line.includes('TYPE_ERROR')) {
      diagnostics.push({
        message: 'Simulated type error',
        severity: 1,
        code: 'FAKE1001',
        range: {
          start: { line: index, character: 0 },
          end: { line: index, character: Math.max(1, line.length) },
        },
      });
    }

    if (line.includes('WARN')) {
      diagnostics.push({
        message: 'Simulated warning',
        severity: 2,
        code: 'FAKE2001',
        range: {
          start: { line: index, character: 0 },
          end: { line: index, character: Math.max(1, line.length) },
        },
      });
    }
  }

  return diagnostics;
}

async function handleRequest(message: JsonRpcRequest): Promise<void> {
  if (message.method === 'initialize') {
    initialized = true;
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: 2,
        },
        serverInfo: {
          name: 'fake-lsp-server',
          version: '1.0.0',
        },
      },
    });
    return;
  }

  if (message.method === 'initialized') {
    return;
  }

  if (message.method === 'shutdown') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: null,
    });
    return;
  }

  if (message.method === 'exit') {
    process.exit(0);
  }

  if (!initialized) {
    if (typeof message.id === 'number') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32002,
          message: 'Server not initialized',
        },
      });
    }
    return;
  }

  // Delay specific request methods without responding (for timeout testing)
  if (
    mode.delayRequestMethods &&
    mode.delayRequestMethods.has(message.method) &&
    typeof message.id === 'number'
  ) {
    if (mode.delayRespondMs && mode.delayRespondMs > 0) {
      // Delay response then send it late (for late-response testing)
      await sleep(mode.delayRespondMs);
      // Fall through to normal handling below after the delay
    } else {
      // Never respond — the request will hang until timeout
      return;
    }
  }

  // Crash on a specific request method
  if (mode.crashOnMethod && message.method === mode.crashOnMethod) {
    process.exit(99);
  }

  if (message.method === 'textDocument/didOpen') {
    if (mode.crashOnDidOpen) {
      process.exit(99);
    }

    const params = message.params as {
      textDocument?: { uri?: string; text?: string };
    };

    const uri = params.textDocument?.uri;
    const text = params.textDocument?.text ?? '';
    if (!uri) {
      return;
    }

    documents.set(uri, text);
    await sendPublishDiagnostics({
      uri,
      diagnostics: [
        ...createDiagnosticsForText(text),
        { message: 123, range: { start: { line: 99, character: 99 } } },
        { message: 'invalid missing range' },
        null,
      ],
    });
    return;
  }

  if (message.method === 'textDocument/didChange') {
    if (mode.crashOnDidChange) {
      process.exit(98);
    }

    const params = message.params as {
      textDocument?: { uri?: string };
      contentChanges?: Array<{ text?: string }>;
    };

    const uri = params.textDocument?.uri;
    if (!uri) {
      return;
    }

    const updated =
      params.contentChanges?.[0]?.text ?? documents.get(uri) ?? '';
    documents.set(uri, updated);

    await sendPublishDiagnostics({
      uri,
      diagnostics: createDiagnosticsForText(updated),
    });
    return;
  }

  // Handle textDocument/hover
  if (message.method === 'textDocument/hover') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        contents: 'fake hover result',
      },
    });
    return;
  }

  // Handle textDocument/definition
  if (message.method === 'textDocument/definition') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: [],
    });
    return;
  }

  // Handle textDocument/documentSymbol
  if (message.method === 'textDocument/documentSymbol') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: [],
    });
    return;
  }

  // Handle textDocument/references
  if (message.method === 'textDocument/references') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: [],
    });
    return;
  }
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on('line', (line) => {
  void (async () => {
    if (!line.trim()) {
      return;
    }

    let message: JsonRpcRequest;
    try {
      message = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return;
    }

    await handleRequest(message);
  })();
});

export const createFakeLspServerFixture = () => ({
  pid: process.pid,
  command: 'fake-lsp-server',
});
