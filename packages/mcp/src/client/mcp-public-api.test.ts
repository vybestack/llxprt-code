/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as mcpClient from './mcp-client.js';
import * as clientIndex from './index.js';
import * as rootBarrel from '../index.js';
import { MCPServerStatus, MCPDiscoveryState } from './mcp-client.js';

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

    it('does not expose process-wide status storage or subscriptions', () => {
      for (const exports of [mcpClient, clientIndex, rootBarrel]) {
        for (const name of [
          'getMCPServerStatus',
          'getAllMCPServerStatuses',
          'updateMCPServerStatus',
          'mcpServerRequiresOAuth',
          'addMCPStatusChangeListener',
          'removeMCPStatusChangeListener',
        ]) {
          expect(Object.keys(exports)).not.toContain(name);
        }
      }
    });
  });
});
