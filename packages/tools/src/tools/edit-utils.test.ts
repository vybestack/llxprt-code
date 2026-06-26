/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IToolHost, IIdeService } from '../interfaces/index.js';
import {
  hasWorkspaceContextCap,
  hasIdeCap,
  hasLspCap,
} from '../interfaces/host-capabilities.js';
import {
  getWorkspaceRootsCompat,
  getLegacyIdeService,
  getLegacyLspService,
  getEmojiFilter,
  createDefaultToolHost,
} from './edit-utils.js';

/** A minimal host with only the required IToolHost surface. */
function plainHost(overrides: Partial<IToolHost> = {}): IToolHost {
  return { ...createDefaultToolHost(), ...overrides };
}

/** A host that also has the IDE capability. */
function ideCapableHost(
  ideClient: unknown,
  ideMode: boolean = true,
): IToolHost {
  const host = plainHost();
  return Object.assign(host, {
    getIdeMode: () => ideMode,
    getIdeClient: () => ideClient,
  });
}

/** A host that also has the LSP capability. */
function lspCapableHost(lspClient: unknown, lspConfig?: unknown): IToolHost {
  const host = plainHost();
  return Object.assign(host, {
    getLspServiceClient: () => lspClient,
    getLspConfig: lspConfig !== undefined ? () => lspConfig : undefined,
  });
}

describe('host capability type guards', () => {
  describe('hasWorkspaceContextCap', () => {
    it('returns true for host with getWorkspaceContext', () => {
      const host = plainHost();
      Object.assign(host, {
        getWorkspaceContext: () => ({ getDirectories: () => ['/root'] }),
      });
      expect(hasWorkspaceContextCap(host)).toBe(true);
    });

    it('returns false for plain host without getWorkspaceContext', () => {
      const host = plainHost();
      expect(hasWorkspaceContextCap(host)).toBe(false);
    });
  });

  describe('hasIdeCap', () => {
    it('returns true for host with getIdeMode and getIdeClient', () => {
      const host = ideCapableHost({ openDiff: () => {} });
      expect(hasIdeCap(host)).toBe(true);
    });

    it('returns false for plain host', () => {
      const host = plainHost();
      expect(hasIdeCap(host)).toBe(false);
    });
  });

  describe('hasLspCap', () => {
    it('returns true for host with getLspServiceClient', () => {
      const host = lspCapableHost({ isAlive: () => true });
      expect(hasLspCap(host)).toBe(true);
    });

    it('returns false for plain host', () => {
      const host = plainHost();
      expect(hasLspCap(host)).toBe(false);
    });
  });
});

describe('getWorkspaceRootsCompat', () => {
  it('uses getWorkspaceContext when available', () => {
    const host = plainHost();
    Object.assign(host, {
      getWorkspaceContext: () => ({
        getDirectories: () => ['/ws1', '/ws2'],
      }),
    });
    expect(getWorkspaceRootsCompat(host)).toEqual(['/ws1', '/ws2']);
  });

  it('falls back to getWorkspaceRoots', () => {
    const host = plainHost();
    // getWorkspaceRoots returns root by default in createDefaultToolHost
    const roots = getWorkspaceRootsCompat(host);
    expect(Array.isArray(roots)).toBe(true);
    expect(roots.length).toBeGreaterThanOrEqual(1);
  });

  it('uses getWorkspaceRoots from the required IToolHost surface', () => {
    const host = plainHost({
      getWorkspaceRoots: () => ['/root1', '/root2'],
    });
    expect(getWorkspaceRootsCompat(host)).toEqual(['/root1', '/root2']);
  });
});

describe('getLegacyIdeService', () => {
  it('returns undefined for plain host without IDE capability', () => {
    const host = plainHost();
    expect(getLegacyIdeService(host)).toBeUndefined();
  });

  it('service is built but applyDiff rejects when IDE mode is false', async () => {
    const host = ideCapableHost({}, false);
    const service = getLegacyIdeService(host);
    expect(service).toBeDefined();
    // IDE mode off means the legacy client is null, so applyDiff rejects
    const result = await service!.applyDiff({
      filePath: '/test.ts',
      diff: 'patch',
    });
    expect(result.status).toBe('rejected');
  });

  it('builds an IIdeService adapter from a capable host', () => {
    const ideClient = {
      openDiff: async () => ({ status: 'accepted' as const, content: 'new' }),
      getConnectionStatus: () => 'connected',
    };
    const host = ideCapableHost(ideClient);
    const service: IIdeService | undefined = getLegacyIdeService(host);
    expect(service).toBeDefined();
    expect(service!.getConnectionStatus()).toBe('connected');
  });

  it('applyDiff delegates to ideClient.openDiff', async () => {
    let openDiffCalled = false;
    const ideClient = {
      openDiff: async (_filePath: string, _content?: string) => {
        openDiffCalled = true;
        return { status: 'accepted' as const, content: 'applied' };
      },
    };
    const host = ideCapableHost(ideClient);
    const service = getLegacyIdeService(host)!;
    const result = await service.applyDiff({
      filePath: '/test.ts',
      diff: 'patch',
    });
    expect(openDiffCalled).toBe(true);
    expect(result.status).toBe('accepted');
  });
});

describe('getLegacyLspService', () => {
  it('returns undefined for plain host without LSP capability', () => {
    const host = plainHost();
    expect(getLegacyLspService(host)).toBeUndefined();
  });

  it('returns undefined when lsp client is null', () => {
    const host = lspCapableHost(null);
    expect(getLegacyLspService(host)).toBeUndefined();
  });

  it('returns undefined when lsp client is not an object', () => {
    const host = lspCapableHost('not-an-object');
    expect(getLegacyLspService(host)).toBeUndefined();
  });

  it('builds an ILspService adapter when client has isAlive', () => {
    const lspClient = {
      isAlive: () => true,
    };
    const host = lspCapableHost(lspClient, { tabSize: 2 });
    const service = getLegacyLspService(host);
    expect(service).toBeDefined();
    // Legacy adapter always returns [] for getDiagnostics
    expect(service!.getDiagnostics('/test.ts')).toEqual([]);
  });

  it('waitForDiagnostics returns [] when client is not alive', async () => {
    const lspClient = {
      isAlive: () => false,
    };
    const host = lspCapableHost(lspClient);
    const service = getLegacyLspService(host)!;
    const diags = await service.waitForDiagnostics('/test.ts', 1000);
    expect(diags).toEqual([]);
  });
});

describe('getEmojiFilter', () => {
  it('reads emojifilter from ephemeral settings', () => {
    const host = plainHost({
      getEphemeralSettings: () => ({ emojifilter: 'allowed' }),
    });
    const filter = getEmojiFilter(host);
    expect(filter).toBeDefined();
  });

  it('defaults when no emojifilter setting is present', () => {
    const host = plainHost({
      getEphemeralSettings: () => ({}),
    });
    const filter = getEmojiFilter(host);
    expect(filter).toBeDefined();
  });
});
