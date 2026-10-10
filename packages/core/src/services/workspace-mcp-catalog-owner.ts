/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DiscoveredMCPPrompt,
  McpPromptRegistry,
  McpResourceRegistry,
} from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import {
  McpError,
  ErrorCode,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import {
  ResourceRegistry,
  type DiscoveredMCPResource,
} from '../resources/resource-registry.js';

export interface WorkspacePromptSelection {
  listPrompts(server: string): DiscoveredMCPPrompt[];
}

export interface WorkspaceResourceSelection {
  listResources(): DiscoveredMCPResource[];
  findResource(identifier: string): DiscoveredMCPResource | undefined;
  readResource(server: string, uri: string): Promise<ReadResourceResult>;
}

export class WorkspaceMcpCatalogOwner {
  private readonly prompts = new PromptRegistry();
  private readonly resources = new ResourceRegistry();
  private readonly admission = new AbortController();
  private readonly pending = new Map<Promise<unknown>, AbortSignal>();
  private readonly promptTokens = new Map<string, Map<string, symbol>>();
  private closing: Promise<void> | undefined;
  private acceptedAtClose: ReadonlyArray<
    readonly [Promise<unknown>, AbortSignal]
  > = [];
  private readonly stoppedError = new Error('Workspace MCP catalog is stopped');
  private closed = false;

  readonly promptPublication: McpPromptRegistry = {
    registerPrompt: (prompt) => {
      this.assertAuthorized();
      const token = Symbol(prompt.name);
      const serverTokens =
        this.promptTokens.get(prompt.serverName) ?? new Map<string, symbol>();
      serverTokens.set(prompt.name, token);
      this.promptTokens.set(prompt.serverName, serverTokens);
      this.prompts.registerPrompt({
        ...prompt,
        invoke: (params, signal) =>
          this.accept(
            (lifetime) => prompt.invoke(params, lifetime),
            signal,
            () => {
              if (
                this.promptTokens.get(prompt.serverName)?.get(prompt.name) !==
                token
              )
                throw new Error('MCP prompt publication was withdrawn');
            },
          ),
      });
    },
    removePromptsByServer: (server) => {
      this.prompts.removePromptsByServer(server);
      this.promptTokens.delete(server);
    },
  };

  readonly resourcePublication: McpResourceRegistry = {
    setResourcesForServer: (server, resources) => {
      this.assertAuthorized();
      this.resources.setResourcesForServer(server, resources);
    },
    removeResourcesByServer: (server) =>
      this.resources.removeResourcesByServer(server),
  };

  readonly promptSelection: WorkspacePromptSelection = {
    listPrompts: (server) => {
      this.assertOpen();
      return this.isTrusted() ? this.prompts.getPromptsByServer(server) : [];
    },
  };

  readonly resourceSelection: WorkspaceResourceSelection = {
    listResources: () => {
      this.assertOpen();
      return this.isTrusted() ? this.resources.getAllResources() : [];
    },
    findResource: (identifier) => {
      this.assertOpen();
      return this.isTrusted()
        ? this.resources.findResourceByUri(identifier)
        : undefined;
    },
    readResource: (server, uri) =>
      this.accept((signal) => this.read(server, uri, signal)),
  };

  constructor(
    private readonly isTrusted: () => boolean,
    private readonly read: (
      server: string,
      uri: string,
      signal: AbortSignal,
    ) => Promise<ReadResourceResult>,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw this.stoppedError;
  }

  private assertAuthorized(): void {
    this.assertOpen();
    if (!this.isTrusted()) throw new Error('MCP capability is not authorized');
  }

  private async accept<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    checkPublication: () => void = () => {},
  ): Promise<T> {
    this.assertAuthorized();
    const lifetime = signal
      ? AbortSignal.any([signal, this.admission.signal])
      : this.admission.signal;
    lifetime.throwIfAborted();
    checkPublication();
    const work = Promise.resolve().then(async () => {
      this.assertAuthorized();
      lifetime.throwIfAborted();
      checkPublication();
      const value = await operation(lifetime);
      lifetime.throwIfAborted();
      this.assertAuthorized();
      checkPublication();
      return value;
    });
    this.pending.set(work, lifetime);
    const release = (): void => {
      this.pending.delete(work);
    };
    void work.then(release, release);
    return work;
  }

  closeAdmission(): void {
    if (this.closed) return;
    this.closed = true;
    this.acceptedAtClose = [...this.pending];
    this.admission.abort(this.stoppedError);
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closeAdmission();
    this.closing = this.drain();
    return this.closing;
  }

  private async drain(): Promise<void> {
    const accepted = this.acceptedAtClose;
    const results = await Promise.allSettled(accepted.map(([work]) => work));
    this.promptTokens.clear();
    this.prompts.clear();
    this.resources.clear();
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected' &&
      !isOperationCancellation(result.reason, accepted[index][1])
        ? [result.reason]
        : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Workspace MCP operations failed');
  }
}

function isOperationCancellation(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  const reason: unknown = signal.reason;
  return (
    error === reason ||
    (error instanceof McpError &&
      error.code === ErrorCode.RequestTimeout &&
      error.message ===
        new McpError(ErrorCode.RequestTimeout, String(reason)).message)
  );
}
