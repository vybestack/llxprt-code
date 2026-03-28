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
  diagnostics: Diagnostic[];
};

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
};

const MULTI_BYTE_ERROR = 'エラー: 型が一致しません (type mismatch error)';
const MULTI_BYTE_WARN = '警告: 使用されていない変数 (unused variable)';

const documents = new Map<string, string>();
let initialized = false;

function send(message: unknown): void {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

async function sendPublishDiagnostics(
  params: PublishDiagnosticsParams,
): Promise<void> {
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
        message: MULTI_BYTE_ERROR,
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
        message: MULTI_BYTE_WARN,
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
          name: 'fake-lsp-server-content-length',
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

  if (message.method === 'textDocument/didOpen') {
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
      diagnostics: createDiagnosticsForText(text),
    });
    return;
  }

  if (message.method === 'textDocument/didChange') {
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
  }
}

let inputBuffer: Buffer = Buffer.alloc(0);

const INPUT_SEPARATOR = Buffer.from('\r\n\r\n');

process.stdin.on('data', (chunk: Buffer | string) => {
  inputBuffer = Buffer.concat([
    inputBuffer,
    typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
  ]);

  while (true) {
    const headerEnd = inputBuffer.indexOf(INPUT_SEPARATOR);
    if (headerEnd < 0) {
      return;
    }

    const header = inputBuffer.subarray(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      return;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const start = headerEnd + INPUT_SEPARATOR.length;
    const end = start + contentLength;

    if (inputBuffer.length < end) {
      return;
    }

    const payload = inputBuffer.subarray(start, end).toString('utf8');
    inputBuffer = inputBuffer.subarray(end);

    void (async () => {
      let message: JsonRpcRequest;
      try {
        message = JSON.parse(payload) as JsonRpcRequest;
      } catch {
        return;
      }

      await handleRequest(message);
    })();
  }
});
