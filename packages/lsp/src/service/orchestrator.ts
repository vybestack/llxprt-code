/**
 * @plan PLAN-20250212-LSP.P19
 * @pseudocode orchestrator.md lines 01-020
 * @pseudocode orchestrator.md lines 021-040
 * @pseudocode orchestrator.md lines 041-060
 * @pseudocode orchestrator.md lines 061-080
 * @pseudocode orchestrator.md lines 081-100
 * @pseudocode orchestrator.md lines 101-120
 */

import { extname, normalize, resolve } from 'node:path';

import type { Diagnostic } from './diagnostics.js';
import { LspClient, type DocumentSymbol, type Location } from './lsp-client.js';
import type { LspServerConfig } from '../types.js';

export type ClientOpQueue = Promise<void>;

export interface ServerStatus {
  serverId: string;
  state: 'ok' | 'broken' | 'starting';
}

export interface WorkspaceSymbol {
  name: string;
  file: string;
  line: number;
  char: number;
}

type ClientKey = string;

const DEFAULT_WAIT_MS = 1200;

interface OrchestratorServerConfig extends LspServerConfig {
  extensions?: string[];
}

interface OrchestratorConfig {
  servers?: OrchestratorServerConfig[];
  diagnosticsTimeoutMs?: number;
  navigationTimeoutMs?: number;
}

export class Orchestrator {
  private readonly clients = new Map<ClientKey, LspClient>();
  private readonly brokenServers = new Set<ClientKey>();
  private readonly firstTouchServers = new Set<ClientKey>();
  private readonly startupPromises = new Map<ClientKey, Promise<LspClient>>();
  private readonly opQueues = new Map<ClientKey, ClientOpQueue>();
  private readonly knownFileDiagSources = new Map<string, Set<string>>();
  private readonly diagnosticsByFile = new Map<string, Diagnostic[]>();
  private readonly serverById = new Map<string, LspServerConfig>();
  private diagnosticEpoch = 0;
  private readonly diagnosticEvents: Array<{ epoch: number; file: string }> =
    [];
  private readonly workspaceRootAbs: string;

  public constructor(
    private readonly config: OrchestratorConfig,
    workspaceRoot: string,
  ) {
    this.workspaceRootAbs = this.normalizeAbsolutePath(workspaceRoot);
    for (const server of config.servers ?? []) {
      this.serverById.set(server.id, server);
    }
  }

  public async checkFile(
    filePath: string,
    text = '',
    signal?: AbortSignal,
  ): Promise<Diagnostic[]> {
    const normalizedFile = this.normalizeAbsolutePath(filePath);
    if (!this.isInsideWorkspace(normalizedFile)) {
      return [];
    }

    const servers = this.getServersForFile(normalizedFile);
    if (servers.length === 0) {
      return [];
    }

    const allDiagnostics: Diagnostic[] = [];

    await Promise.all(
      servers.map(async (server) => {
        const key = this.getClientKey(server.id);
        if (this.brokenServers.has(key)) {
          return;
        }

        const client = await this.ensureClient(server).catch(() => null);
        if (!client) {
          this.brokenServers.add(key);
          return;
        }

        const diagnostics = await this.enqueueClientOp(key, async () => {
          try {
            await client.touchFile(normalizedFile, text);
            const waitMs = this.config.diagnosticsTimeoutMs ?? DEFAULT_WAIT_MS;
            const output = await client.waitForDiagnostics(
              normalizedFile,
              waitMs,
              signal,
            );
            this.firstTouchServers.add(key);
            if (!client.isAlive()) {
              this.brokenServers.add(key);
              this.clients.delete(key);
              this.startupPromises.delete(key);
              return [];
            }
            return output;
          } catch {
            this.brokenServers.add(key);
            this.clients.delete(key);
            this.startupPromises.delete(key);
            return [];
          }
        });

        if (diagnostics.length > 0) {
          this.knownFileDiagSources.set(
            normalizedFile,
            this.appendKnownSource(normalizedFile, key),
          );
        } else {
          this.removeKnownSource(normalizedFile, key);
        }
        allDiagnostics.push(...diagnostics);
      }),
    );

    this.diagnosticsByFile.set(normalizedFile, allDiagnostics);
    this.bumpEpoch(normalizedFile);
    return allDiagnostics;
  }

  public async getAllDiagnostics(): Promise<Record<string, Diagnostic[]>> {
    const snapshot: Record<string, Diagnostic[]> = {};
    for (const [file] of this.knownFileDiagSources) {
      snapshot[file] = [...(this.diagnosticsByFile.get(file) ?? [])];
    }
    return snapshot;
  }

  public getDiagnosticEpoch(): number {
    return this.diagnosticEpoch;
  }

  public async getAllDiagnosticsAfter(
    afterEpoch: number,
    waitMs = 0,
  ): Promise<Record<string, Diagnostic[]>> {
    if (afterEpoch >= this.diagnosticEpoch && waitMs > 0) {
      await new Promise((resolveTimeout) => setTimeout(resolveTimeout, waitMs));
    }

    const touchedFiles = new Set(
      this.diagnosticEvents
        .filter((event) => event.epoch > afterEpoch)
        .map((event) => event.file),
    );

    const snapshot: Record<string, Diagnostic[]> = {};
    for (const file of touchedFiles) {
      snapshot[file] = [...(this.diagnosticsByFile.get(file) ?? [])];
    }
    return snapshot;
  }

  public async status(): Promise<ServerStatus[]> {
    const configured = [...this.serverById.keys()];
    const known = new Set<string>();

    for (const clientKey of this.clients.keys()) {
      known.add(this.serverIdFromKey(clientKey));
    }
    for (const clientKey of this.brokenServers) {
      known.add(this.serverIdFromKey(clientKey));
    }

    const allServerIds = [...new Set([...configured, ...known])].sort((a, b) =>
      a.localeCompare(b),
    );

    return allServerIds.map((serverId) => {
      const key = this.getClientKey(serverId);
      if (this.brokenServers.has(key)) {
        return { serverId, state: 'broken' as const };
      }
      if (this.startupPromises.has(key) && !this.clients.has(key)) {
        return { serverId, state: 'starting' as const };
      }
      if (this.clients.has(key)) {
        const client = this.clients.get(key);
        if (client && !client.isAlive()) {
          this.brokenServers.add(key);
          this.clients.delete(key);
          this.startupPromises.delete(key);
          return { serverId, state: 'broken' as const };
        }
        return { serverId, state: 'ok' as const };
      }
      return { serverId, state: 'broken' as const };
    });
  }

  public async gotoDefinition(
    file: string,
    line: number,
    char: number,
  ): Promise<Location[]> {
    const client = await this.getClientForNavigation(file);
    if (!client) {
      return [];
    }
    const normalizedFile = this.normalizeAbsolutePath(file);
    const result = await this.withTimeout(
      () => client.gotoDefinition(normalizedFile, line, char),
      [] as Location[],
    );
    if (result.length > 0) {
      return result;
    }
    if (this.isInsideWorkspace(normalizedFile)) {
      return [{ file: normalizedFile, line, char }];
    }
    return [];
  }

  public async findReferences(
    file: string,
    line: number,
    char: number,
  ): Promise<Location[]> {
    const client = await this.getClientForNavigation(file);
    if (!client) {
      return [];
    }
    const normalizedFile = this.normalizeAbsolutePath(file);
    return await this.withTimeout(
      () => client.findReferences(normalizedFile, line, char),
      [] as Location[],
    );
  }

  public async hover(
    file: string,
    line: number,
    char: number,
  ): Promise<string | null> {
    const client = await this.getClientForNavigation(file);
    if (!client) {
      return null;
    }
    const normalizedFile = this.normalizeAbsolutePath(file);
    return await this.withTimeout(
      () => client.hover(normalizedFile, line, char),
      null,
    );
  }

  public async documentSymbols(file: string): Promise<DocumentSymbol[]> {
    const client = await this.getClientForNavigation(file);
    if (!client) {
      return [];
    }
    const normalizedFile = this.normalizeAbsolutePath(file);
    return await this.withTimeout(
      () => client.documentSymbols(normalizedFile),
      [] as DocumentSymbol[],
    );
  }

  public async workspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
    void query;
    return [];
  }

  public async shutdown(): Promise<void> {
    const clients = [...this.clients.values()];
    await Promise.all(
      clients.map(async (client) => {
        try {
          await client.shutdown();
        } catch {
          // best-effort cleanup
        }
      }),
    );

    this.clients.clear();
    this.firstTouchServers.clear();
    this.startupPromises.clear();
    this.opQueues.clear();
    this.knownFileDiagSources.clear();
    this.diagnosticsByFile.clear();
    this.diagnosticEvents.length = 0;
    this.diagnosticEpoch = 0;
  }

  private normalizeAbsolutePath(path: string): string {
    return normalize(resolve(path));
  }

  private isInsideWorkspace(path: string): boolean {
    if (path === this.workspaceRootAbs) {
      return true;
    }
    return path.startsWith(`${this.workspaceRootAbs}/`);
  }

  private getServersForFile(filePath: string): LspServerConfig[] {
    const fileExtension = extname(filePath).toLowerCase();
    return (this.config.servers ?? []).filter((server) =>
      (server.extensions ?? []).some(
        (extension) => extension.toLowerCase() === fileExtension,
      ),
    );
  }

  private getClientKey(serverId: string): ClientKey {
    return `${serverId}::${this.workspaceRootAbs}`;
  }

  private serverIdFromKey(key: ClientKey): string {
    const [serverId] = key.split('::');
    return serverId;
  }

  private appendKnownSource(file: string, source: string): Set<string> {
    const current = this.knownFileDiagSources.get(file) ?? new Set<string>();
    current.add(source);
    return current;
  }

  private removeKnownSource(file: string, source: string): void {
    const current = this.knownFileDiagSources.get(file);
    if (!current) {
      return;
    }
    current.delete(source);
    if (current.size === 0) {
      this.knownFileDiagSources.delete(file);
      this.diagnosticsByFile.delete(file);
    }
  }

  private async ensureClient(server: LspServerConfig): Promise<LspClient> {
    const key = this.getClientKey(server.id);
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const inFlight = this.startupPromises.get(key);
    if (inFlight) {
      return await inFlight;
    }

    const startup = (async () => {
      const client = new LspClient({ config: server }, this.workspaceRootAbs);
      await client.initialize();
      this.clients.set(key, client);
      this.startupPromises.delete(key);
      return client;
    })();

    this.startupPromises.set(key, startup);
    return await startup;
  }

  private async enqueueClientOp<T>(
    key: ClientKey,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.opQueues.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const next = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });

    this.opQueues.set(
      key,
      previous.then(() => next),
    );

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async getClientForNavigation(
    file: string,
  ): Promise<LspClient | null> {
    const normalizedFile = this.normalizeAbsolutePath(file);
    if (
      !this.isInsideWorkspace(normalizedFile) ||
      !normalizedFile.startsWith(this.workspaceRootAbs)
    ) {
      return null;
    }

    const server = this.getServersForFile(normalizedFile)[0];
    if (!server) {
      return null;
    }

    const key = this.getClientKey(server.id);
    if (this.brokenServers.has(key)) {
      return null;
    }

    try {
      return await this.ensureClient(server);
    } catch {
      this.brokenServers.add(key);
      return null;
    }
  }

  private async withTimeout<T>(
    operation: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    const timeoutMs = this.config.navigationTimeoutMs ?? DEFAULT_WAIT_MS;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((resolveTimeout) => {
          setTimeout(() => resolveTimeout(fallback), timeoutMs);
        }),
      ]);
    } catch {
      return fallback;
    }
  }

  private bumpEpoch(file: string): void {
    this.diagnosticEpoch += 1;
    this.diagnosticEvents.push({ epoch: this.diagnosticEpoch, file });
  }
}

export const createOrchestrator = (
  config: OrchestratorConfig = {},
  workspaceRoot = '/workspace',
): Orchestrator => new Orchestrator(config, workspaceRoot);
