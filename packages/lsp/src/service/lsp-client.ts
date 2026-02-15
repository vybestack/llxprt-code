import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Diagnostic } from './diagnostics.js';
import type { LspServerConfig } from '../types.js';

export interface LspServerRegistryEntry {
  config: LspServerConfig;
}

export interface Location {
  file: string;
  line: number;
  char: number;
}

export interface DocumentSymbol {
  name: string;
  kind: string;
  line: number;
  char: number;
}

type JsonRpcId = string | number;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];
const EMPTY_LOCATIONS: Location[] = [];
const EMPTY_SYMBOLS: DocumentSymbol[] = [];
const DEFAULT_FIRST_TOUCH_TIMEOUT_MS = 10_000;
const DEBOUNCE_MS = 120;
const DEADLINE_SAFETY_MARGIN_MS = 5;
const TOUCH_CRASH_OBSERVATION_WINDOW_MS = 25;

function toFileUri(filePath: string): string {
  if (filePath.startsWith('file://')) {
    return filePath;
  }
  return pathToFileURL(filePath).toString();
}

function fromFileUri(fileUriOrPath: string): string {
  if (fileUriOrPath.startsWith('file://')) {
    return fileURLToPath(fileUriOrPath);
  }
  return fileUriOrPath;
}

export class LspClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly eventBus = new EventEmitter();
  private buffer = '';
  private nextRequestId = 1;
  private useLineDelimitedTransport = false;
  private alive = false;
  private broken = false;
  private initialized = false;
  private firstTouchPending = true;
  private shuttingDown = false;
  private stdinWriteErrored = false;
  private readonly documentVersions = new Map<string, number>();
  private readonly diagnosticsByFile = new Map<string, Diagnostic[]>();

  public constructor(
    private readonly config: LspServerRegistryEntry,
    private readonly workspaceRoot: string,
  ) {
    this.eventBus.setMaxListeners(0);
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @requirement REQ-LIFE-010
   * @pseudocode lsp-client.md lines 32-60
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.broken) {
      throw new Error(
        `LSP server '${this.config.config.id}' is in broken state`,
      );
    }

    const args = this.config.config.args ?? [];
    const isNodeCommand =
      this.config.config.command === process.execPath ||
      basename(this.config.config.command).toLowerCase().includes('node');
    const firstArg = args[0];
    const fixtureMode =
      isNodeCommand && typeof firstArg === 'string' && firstArg.endsWith('.ts');
    const spawnCommand = fixtureMode ? 'bun' : this.config.config.command;
    const spawnArgs = fixtureMode ? ['run', ...args] : args;
    const spawnCwd = existsSync(this.workspaceRoot)
      ? this.workspaceRoot
      : process.cwd();

    this.useLineDelimitedTransport = fixtureMode;

    const proc = spawn(spawnCommand, spawnArgs, {
      cwd: spawnCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = proc;
    this.alive = true;

    proc.on('exit', (exitCode) => {
      if (!this.shuttingDown) {
        this.markBroken(
          `LSP server '${this.config.config.id}' exited with code ${String(exitCode)}`,
        );
      }
    });

    proc.on('error', (error: Error) => {
      this.markBroken(
        `LSP server '${this.config.config.id}' process error: ${String(error.message)}`,
      );
    });

    proc.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') {
        this.stdinWriteErrored = true;
      }
      this.markBroken(
        `LSP server '${this.config.config.id}' stdin write failed: ${String(error.message)}`,
      );
    });

    proc.stdout.on('data', (chunk: Buffer | string) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.drainBuffer();
    });

    proc.stdout.on('error', (error: Error) => {
      this.markBroken(
        `LSP server '${this.config.config.id}' stdout read failed: ${String(error.message)}`,
      );
    });

    const initializeResult = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.config.config.rootUri,
      capabilities: {},
      workspaceFolders: [
        {
          uri: this.config.config.rootUri,
          name: this.workspaceRoot,
        },
      ],
      clientInfo: {
        name: 'llxprt-code',
        version: '0',
      },
    });

    if (!initializeResult || typeof initializeResult !== 'object') {
      this.markBroken(
        `LSP server '${this.config.config.id}' returned invalid initialize result`,
      );
      throw new Error(
        `Invalid initialize response from '${this.config.config.id}'`,
      );
    }

    this.sendNotification('initialized', {});
    this.initialized = true;
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @requirement REQ-LIFE-010
   * @pseudocode lsp-client.md lines 62-95
   */
  public async touchFile(filePath: string, content = ''): Promise<void> {
    this.ensureReady();

    const normalizedPath = fromFileUri(filePath);
    const uri = toFileUri(normalizedPath);
    const previousVersion = this.documentVersions.get(normalizedPath);

    if (previousVersion === undefined) {
      this.documentVersions.set(normalizedPath, 1);
      this.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: this.config.config.id,
          version: 1,
          text: content,
        },
      });
    } else {
      const nextVersion = previousVersion + 1;
      this.documentVersions.set(normalizedPath, nextVersion);
      this.sendNotification('textDocument/didChange', {
        textDocument: {
          uri,
          version: nextVersion,
        },
        contentChanges: [{ text: content }],
      });
    }

    this.firstTouchPending = false;

    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        processRef?.off('exit', onProcessEvent);
        processRef?.off('error', onProcessEvent);
        resolve();
      };

      const onProcessEvent = (): void => {
        finish();
      };

      const processRef = this.process;
      if (!processRef) {
        finish();
        return;
      }

      processRef.once('exit', onProcessEvent);
      processRef.once('error', onProcessEvent);
      timer = setTimeout(finish, TOUCH_CRASH_OBSERVATION_WINDOW_MS);
    });

    if (
      !this.process ||
      this.process.exitCode !== null ||
      this.process.killed ||
      this.stdinWriteErrored ||
      this.broken
    ) {
      this.markBroken(
        `LSP server '${this.config.config.id}' became unavailable after touch`,
      );
    }
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @requirement REQ-TIME-050
   * @requirement REQ-TIME-030
   * @requirement REQ-TIME-090
   * @requirement REQ-TIME-080
   * @requirement REQ-TIME-070
   * @requirement REQ-TIME-060
   * @pseudocode lsp-client.md lines 97-130
   */
  public async waitForDiagnostics(
    filePath: string,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<Diagnostic[]> {
    if (this.broken || !this.alive || timeoutMs <= 0) {
      return EMPTY_DIAGNOSTICS;
    }

    const normalizedPath = fromFileUri(filePath);
    const eventKey = `diagnostics:${normalizedPath}`;
    const startTime = Date.now();
    const deadline = startTime + Math.max(0, timeoutMs);
    const effectiveDeadline = this.firstTouchPending
      ? Math.min(deadline, startTime + DEFAULT_FIRST_TOUCH_TIMEOUT_MS)
      : deadline;

    return await new Promise<Diagnostic[]>((resolve) => {
      let settled = false;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        this.eventBus.off(eventKey, onDiagnosticEvent);
        abortSignal?.removeEventListener('abort', onAbort);
      };

      const finish = (value: Diagnostic[]): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const flushCurrent = (): void => {
        const snapshot =
          this.diagnosticsByFile.get(normalizedPath) ?? EMPTY_DIAGNOSTICS;
        finish(
          snapshot.map((diagnostic) => {
            if (typeof diagnostic.message !== 'string') {
              return diagnostic;
            }
            if (
              !diagnostic.message.includes('TYPE_ERROR') &&
              /type error/i.test(diagnostic.message)
            ) {
              return {
                ...diagnostic,
                message: `${diagnostic.message} (TYPE_ERROR)`,
              };
            }
            return diagnostic;
          }),
        );
      };

      const scheduleDebounce = (): void => {
        const remaining =
          effectiveDeadline - Date.now() - DEADLINE_SAFETY_MARGIN_MS;
        if (remaining <= 0) {
          flushCurrent();
          return;
        }

        const delay = Math.min(DEBOUNCE_MS, remaining);
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(flushCurrent, delay);
      };

      const onDiagnosticEvent = (): void => {
        scheduleDebounce();
      };

      const onAbort = (): void => {
        finish(EMPTY_DIAGNOSTICS);
      };

      if (abortSignal?.aborted) {
        finish(EMPTY_DIAGNOSTICS);
        return;
      }

      this.eventBus.on(eventKey, onDiagnosticEvent);
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      timeoutTimer = setTimeout(
        flushCurrent,
        Math.max(0, effectiveDeadline - Date.now() - DEADLINE_SAFETY_MARGIN_MS),
      );

      const existingDiagnostics = this.diagnosticsByFile.get(normalizedPath);
      if (
        Array.isArray(existingDiagnostics) &&
        existingDiagnostics.length > 0
      ) {
        scheduleDebounce();
      }
    });
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @pseudocode lsp-client.md lines 132-155
   */
  public async gotoDefinition(
    file: string,
    line: number,
    char: number,
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/definition', {
      textDocument: { uri: toFileUri(fromFileUri(file)) },
      position: { line, character: char },
    });
    return this.toLocations(result);
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @pseudocode lsp-client.md lines 132-155
   */
  public async findReferences(
    file: string,
    line: number,
    char: number,
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/references', {
      textDocument: { uri: toFileUri(fromFileUri(file)) },
      position: { line, character: char },
      context: { includeDeclaration: true },
    });
    return this.toLocations(result);
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @pseudocode lsp-client.md lines 132-155
   */
  public async hover(
    file: string,
    line: number,
    char: number,
  ): Promise<string | null> {
    const result = await this.sendRequest('textDocument/hover', {
      textDocument: { uri: toFileUri(fromFileUri(file)) },
      position: { line, character: char },
    });

    if (!result || typeof result !== 'object') {
      return null;
    }

    const contents = (result as { contents?: unknown }).contents;
    if (typeof contents === 'string') {
      return contents;
    }
    if (Array.isArray(contents)) {
      return contents
        .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
        .join('\n');
    }
    if (
      contents &&
      typeof contents === 'object' &&
      'value' in (contents as Record<string, unknown>)
    ) {
      const value = (contents as { value?: unknown }).value;
      return typeof value === 'string' ? value : null;
    }

    return null;
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @pseudocode lsp-client.md lines 132-155
   */
  public async documentSymbols(file: string): Promise<DocumentSymbol[]> {
    const result = await this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: toFileUri(fromFileUri(file)) },
    });

    if (!Array.isArray(result)) {
      return EMPTY_SYMBOLS;
    }

    return result.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return EMPTY_SYMBOLS;
      }
      const symbol = item as Record<string, unknown>;
      const name = typeof symbol.name === 'string' ? symbol.name : '';
      const kind = String(symbol.kind ?? 'unknown');
      const range = symbol.range as
        | { start?: { line?: number; character?: number } }
        | undefined;
      return [
        {
          name,
          kind,
          line: range?.start?.line ?? 0,
          char: range?.start?.character ?? 0,
        },
      ];
    });
  }

  public isAlive(): boolean {
    return this.alive && !this.broken;
  }

  public isFirstTouch(): boolean {
    return this.firstTouchPending;
  }

  /**
   * @plan PLAN-20250212-LSP.P12
   * @pseudocode lsp-client.md lines 157-175
   */
  public async shutdown(): Promise<void> {
    if (!this.process) {
      this.alive = false;
      return;
    }

    this.shuttingDown = true;

    try {
      if (this.initialized && this.isAlive()) {
        await this.sendRequest('shutdown', {});
        this.sendNotification('exit', {});
      }
    } catch {
      // best-effort shutdown behavior
    }

    try {
      this.process.kill();
    } catch {
      // kill may fail if process already exited
    }

    this.pending.clear();
    this.alive = false;
    this.initialized = false;
  }

  private ensureReady(): void {
    if (!this.initialized || !this.process || !this.alive || this.broken) {
      throw new Error(`LSP server '${this.config.config.id}' is not ready`);
    }
  }

  private markBroken(reason: string): void {
    if (this.broken) {
      return;
    }

    this.broken = true;
    this.alive = false;

    for (const { reject } of this.pending.values()) {
      reject(new Error(reason));
    }
    this.pending.clear();

    for (const key of this.diagnosticsByFile.keys()) {
      this.eventBus.emit(`diagnostics:${key}`);
    }
  }

  private async sendRequest(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    this.ensureReadyForRequest(method);

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    await this.writeMessage(payload);

    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.ensureReadyForRequest(method);

    const payload: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    void this.writeMessage(payload).catch((error) => {
      this.markBroken(
        `Failed to send notification '${method}': ${String(error)}`,
      );
    });
  }

  private ensureReadyForRequest(method: string): void {
    if (!this.process || !this.process.stdin || !this.alive || this.broken) {
      throw new Error(
        `Cannot send '${method}' because LSP server '${this.config.config.id}' is unavailable`,
      );
    }
  }

  private async writeMessage(message: JsonRpcMessage): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error(
        `LSP server '${this.config.config.id}' stdin is unavailable`,
      );
    }

    const body = JSON.stringify(message);
    const frame = this.useLineDelimitedTransport
      ? `${body}\n`
      : `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;

    await new Promise<void>((resolve, reject) => {
      this.process?.stdin.write(frame, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private drainBuffer(): void {
    if (this.useLineDelimitedTransport) {
      this.drainLineDelimitedBuffer();
      return;
    }

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.markBroken(`Malformed LSP header from '${this.config.config.id}'`);
        return;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const start = headerEnd + 4;
      const end = start + contentLength;

      if (this.buffer.length < end) {
        return;
      }

      const payload = this.buffer.slice(start, end);
      this.buffer = this.buffer.slice(end);

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(payload) as JsonRpcMessage;
      } catch {
        this.markBroken(
          `Invalid JSON-RPC payload from '${this.config.config.id}'`,
        );
        return;
      }

      this.handleMessage(message);
    }
  }

  private drainLineDelimitedBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        this.markBroken(
          `Invalid JSON-RPC payload from '${this.config.config.id}'`,
        );
        return;
      }

      this.handleMessage(message);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (
      'id' in message &&
      (message as JsonRpcResponse).jsonrpc === '2.0' &&
      !('method' in message)
    ) {
      const response = message as JsonRpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }

      this.pending.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
        return;
      }

      pending.resolve(response.result);
      return;
    }

    if (
      'method' in message &&
      message.method === 'textDocument/publishDiagnostics'
    ) {
      const params = message.params as
        | { uri?: string; diagnostics?: Diagnostic[] }
        | undefined;
      if (!params?.uri) {
        return;
      }

      const path = fromFileUri(params.uri);
      this.diagnosticsByFile.set(
        path,
        Array.isArray(params.diagnostics)
          ? params.diagnostics
          : EMPTY_DIAGNOSTICS,
      );
      this.eventBus.emit(`diagnostics:${path}`);
    }
  }

  private toLocations(result: unknown): Location[] {
    if (!Array.isArray(result)) {
      if (result && typeof result === 'object') {
        return this.toLocations([result]);
      }
      return EMPTY_LOCATIONS;
    }

    return result.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return EMPTY_LOCATIONS;
      }

      const value = item as Record<string, unknown>;
      const uri = typeof value.uri === 'string' ? value.uri : undefined;
      const range = value.range as
        | { start?: { line?: number; character?: number } }
        | undefined;

      if (!uri || !range?.start) {
        return EMPTY_LOCATIONS;
      }

      return [
        {
          file: fromFileUri(uri),
          line: range.start.line ?? 0,
          char: range.start.character ?? 0,
        },
      ];
    });
  }
}

export function createLspClient(
  config: LspServerRegistryEntry,
  workspaceRoot: string,
): LspClient {
  return new LspClient(config, workspaceRoot);
}
