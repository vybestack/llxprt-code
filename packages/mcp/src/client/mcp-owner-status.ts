/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MCPServerConfig } from '../config/index.js';
import {
  MCPServerStatus,
  type McpServerRuntimeState,
  type McpStatusListener,
} from './mcp-status.js';

export class McpOwnerStatus {
  private readonly entries = new Map<
    string,
    { config: MCPServerConfig; active: boolean; state: McpServerRuntimeState }
  >();
  private readonly listeners = new Set<McpStatusListener>();
  private stopped = false;

  readonly states = (): ReadonlyMap<string, McpServerRuntimeState> =>
    new Map([...this.entries].map(([name, entry]) => [name, entry.state]));
  readonly servers = (): Record<string, MCPServerConfig> =>
    Object.fromEntries(
      [...this.entries].map(([name, entry]) => [name, entry.config]),
    );
  readonly status = (name: string): MCPServerStatus =>
    this.entries.get(name)?.state.status ?? MCPServerStatus.DISCONNECTED;

  readonly subscribe = (listener: McpStatusListener): (() => void) => {
    if (this.stopped) throw new Error('MCP client manager is stopped');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  ensure(name: string, config: MCPServerConfig): void {
    if (!this.entries.has(name)) this.begin(name, config);
  }

  begin(
    name: string,
    config: MCPServerConfig,
  ): (status: MCPServerStatus, requiresOAuth: boolean) => void {
    const entry = {
      config,
      active: true,
      state: {
        status: MCPServerStatus.DISCONNECTED,
        requiresOAuth: config.oauth?.enabled === true,
      },
    };
    this.entries.set(name, entry);
    return (status, requiresOAuth) => {
      if (this.stopped || !entry.active || this.entries.get(name) !== entry)
        return;
      this.update(name, status, requiresOAuth);
    };
  }

  retire(name: string): void {
    const entry = this.entries.get(name);
    if (entry) entry.active = false;
  }

  forget(name: string): void {
    this.entries.delete(name);
    this.notify(name, MCPServerStatus.DISCONNECTED);
  }

  stopAdmission(): void {
    this.stopped = true;
  }
  release(): void {
    this.listeners.clear();
  }

  update(name: string, status: MCPServerStatus, requiresOAuth?: boolean): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    entry.state = {
      status,
      requiresOAuth: requiresOAuth ?? entry.state.requiresOAuth,
    };
    this.notify(name, status);
  }

  private notify(name: string, status: MCPServerStatus): void {
    const failures: unknown[] = [];
    for (const listener of this.listeners) {
      try {
        listener(name, status);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'MCP status notification failed');
  }

  publishDiscoveryComplete(): void {
    if (this.stopped) return;
    for (const [name, entry] of this.entries)
      this.update(name, entry.state.status);
  }
}
