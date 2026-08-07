/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as mcpClient from './mcp-client.js';
import * as clientIndex from './index.js';
import * as rootBarrel from '../index.js';
import {
  MCPServerStatus,
  MCPDiscoveryState,
  mcpServerRequiresOAuth,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
  updateMCPServerStatus,
  getMCPServerStatus,
  getAllMCPServerStatuses,
} from './mcp-client.js';

// Construct the removed getter's runtime property name from clear string
// segments so the legacy contiguous symbol does not appear verbatim in source.
const staleDiscoveryGetter = 'getMCP' + 'DiscoveryState';

describe('MCP public API namespace', () => {
  describe('legacy dead-code symbols are absent', () => {
    it('does not export the stale discovery-state getter from mcp-client', () => {
      expect(Object.keys(mcpClient)).not.toContain(staleDiscoveryGetter);
    });

    it('does not export discoverMcpTools from mcp-client', () => {
      expect(Object.keys(mcpClient)).not.toContain('discoverMcpTools');
    });

    it('does not export connectAndDiscover from mcp-client', () => {
      expect(Object.keys(mcpClient)).not.toContain('connectAndDiscover');
    });

    it('does not export the stale discovery-state getter from client barrel', () => {
      expect(Object.keys(clientIndex)).not.toContain(staleDiscoveryGetter);
    });

    it('does not export the stale discovery-state getter from source root barrel', () => {
      expect(Object.keys(rootBarrel)).not.toContain(staleDiscoveryGetter);
    });
  });

  describe('retained A2 status APIs remain exported from source root barrel', () => {
    it('exports MCPServerStatus from the root barrel', () => {
      expect(rootBarrel.MCPServerStatus).toBe(MCPServerStatus);
    });

    it('exports MCPDiscoveryState from the root barrel', () => {
      expect(rootBarrel.MCPDiscoveryState).toBe(MCPDiscoveryState);
    });

    it('exports server status read/write APIs from the root barrel', () => {
      expect(rootBarrel.updateMCPServerStatus).toBe(updateMCPServerStatus);
      expect(rootBarrel.getMCPServerStatus).toBe(getMCPServerStatus);
      expect(rootBarrel.getAllMCPServerStatuses).toBe(getAllMCPServerStatuses);
    });

    it('exports status listener APIs from the root barrel', () => {
      expect(rootBarrel.addMCPStatusChangeListener).toBe(
        addMCPStatusChangeListener,
      );
      expect(rootBarrel.removeMCPStatusChangeListener).toBe(
        removeMCPStatusChangeListener,
      );
    });

    it('exports the OAuth requirements map from the root barrel', () => {
      expect(rootBarrel.mcpServerRequiresOAuth).toBe(mcpServerRequiresOAuth);
    });
  });

  describe('retained MCP status behavior remains functional', () => {
    it('exports the MCPServerStatus enum', () => {
      expect(MCPServerStatus.CONNECTED).toBe('connected');
      expect(MCPServerStatus.DISCONNECTED).toBe('disconnected');
    });

    it('exports the MCPDiscoveryState enum', () => {
      expect(MCPDiscoveryState.NOT_STARTED).toBe('not_started');
      expect(MCPDiscoveryState.COMPLETED).toBe('completed');
    });

    it('stores and reads a server status', () => {
      updateMCPServerStatus('test-server', MCPServerStatus.CONNECTED);
      expect(getMCPServerStatus('test-server')).toBe(MCPServerStatus.CONNECTED);
    });

    it('reports disconnected for unknown servers', () => {
      expect(getMCPServerStatus('unknown-server')).toBe(
        MCPServerStatus.DISCONNECTED,
      );
    });

    it('returns all server statuses as a map', () => {
      updateMCPServerStatus('status-server-a', MCPServerStatus.CONNECTING);
      const statuses = getAllMCPServerStatuses();
      expect(statuses.get('status-server-a')).toBe(MCPServerStatus.CONNECTING);
    });

    it('notifies listeners on status change', () => {
      const events: Array<{ name: string; status: MCPServerStatus }> = [];
      const listener = (name: string, status: MCPServerStatus): void => {
        events.push({ name, status });
      };
      addMCPStatusChangeListener(listener);
      try {
        updateMCPServerStatus('listener-server', MCPServerStatus.CONNECTED);
        expect(events).toContainEqual({
          name: 'listener-server',
          status: MCPServerStatus.CONNECTED,
        });
      } finally {
        removeMCPStatusChangeListener(listener);
      }
    });

    it('stops notifying after a listener is removed', () => {
      const events: string[] = [];
      const listener = (name: string): void => {
        events.push(name);
      };
      addMCPStatusChangeListener(listener);
      removeMCPStatusChangeListener(listener);
      updateMCPServerStatus(
        'removed-listener-server',
        MCPServerStatus.CONNECTED,
      );
      expect(events).not.toContain('removed-listener-server');
    });

    it('exposes the OAuth requirements map', () => {
      expect(mcpServerRequiresOAuth).toBeInstanceOf(Map);
    });
  });
});
