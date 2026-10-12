/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { physicalFiles } from '../__tests__/helpers/physical-files.js';
import path from 'node:path';
import { promises as fixtureFs } from 'node:fs';

import { describe, it, expect } from 'bun:test';
import type {
  IToolHost,
  IIdeService,
  Diagnostic,
  LspConfig,
} from '../interfaces/index.js';
import { hasIdeCap, hasLspCap } from '../interfaces/host-capabilities.js';
import {
  getWorkspaceRootsCompat,
  getLegacyIdeService,
  getLegacyLspService,
  getEmojiFilter,
} from './edit-utils.js';

/** A minimal host with only the required IToolHost surface. */
function plainHost(overrides: Partial<IToolHost> = {}): IToolHost {
  return {
    readTextFile: (filePath) => fixtureFs.readFile(filePath, 'utf8'),
    writeTextFile: (filePath, content) =>
      fixtureFs.writeFile(filePath, content),
    getTargetDir: () => process.cwd(),
    getWorkspaceRoots: () => [path.parse(process.cwd()).root],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,

    runSearch: <T>(
      _directories: readonly string[],
      operation: () => Promise<T>,
    ): Promise<T> => operation(),
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    readExecutionPolicy: () => ({}),
    getDebugMode: () => false,
    ...overrides,
  };
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
function lspCapableHost(
  diagnostics:
    | ((file: string, timeout: number) => Promise<Diagnostic[]>)
    | undefined,
  lspConfig?: LspConfig,
): IToolHost {
  const host = plainHost();
  return Object.assign(host, {
    checkFileDiagnostics: diagnostics,
    getLspConfig: lspConfig !== undefined ? () => lspConfig : undefined,
  });
}

describe('host capability type guards', () => {
  describe('required workspace root operations', () => {
    it('reads explicitly supplied workspace roots', () => {
      const host = plainHost();
      Object.assign(host, {
        ...physicalFiles,
        getWorkspaceRoots: () => ['/root'],
      });
      expect(getWorkspaceRootsCompat(host)).toStrictEqual(['/root']);
    });

    it('does not add an undeclared directory to plain host roots', () => {
      const host = plainHost();
      expect(getWorkspaceRootsCompat(host)).not.toContain(
        '/undeclared-workspace',
      );
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
    it('returns true for host with checkFileDiagnostics', () => {
      const host = lspCapableHost(async () => []);
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
      ...physicalFiles,
      getWorkspaceRoots: () => ['/ws1', '/ws2'],
    });
    expect(getWorkspaceRootsCompat(host)).toStrictEqual(['/ws1', '/ws2']);
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
      ...physicalFiles,
      getWorkspaceRoots: () => ['/root1', '/root2'],
    });
    expect(getWorkspaceRootsCompat(host)).toStrictEqual(['/root1', '/root2']);
  });

  it('returns empty array when workspace context has no directories', () => {
    const host = plainHost();
    Object.assign(host, {
      ...physicalFiles,
      getWorkspaceRoots: () => [],
    });
    expect(getWorkspaceRootsCompat(host)).toStrictEqual([]);
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
    const captured: { filePath?: string; content?: string } = {};
    const ideClient = {
      openDiff: async (filePath: string, content?: string) => {
        captured.filePath = filePath;
        captured.content = content;
        return { status: 'accepted' as const, content: 'applied' };
      },
    };
    const host = ideCapableHost(ideClient);
    const service = getLegacyIdeService(host)!;
    const result = await service.applyDiff({
      filePath: '/test.ts',
      diff: 'patch',
    });
    expect(captured.filePath).toBe('/test.ts');
    expect(captured.content).toBe('patch');
    expect(result.status).toBe('accepted');
  });
});

describe('getLegacyLspService', () => {
  it('returns undefined for plain host without LSP capability', () => {
    const host = plainHost();
    expect(getLegacyLspService(host)).toBeUndefined();
  });

  it('returns undefined when diagnostic operation is absent', () => {
    const host = lspCapableHost(undefined);
    expect(getLegacyLspService(host)).toBeUndefined();
  });

  it('returns undefined when diagnostic operation is explicitly undefined', () => {
    const host = lspCapableHost(undefined);
    expect(getLegacyLspService(host)).toBeUndefined();
  });

  it('builds a diagnostics-only adapter without exposing a client', () => {
    const host = lspCapableHost(async () => [], {
      includeSeverities: ['error'],
    });
    const service = getLegacyLspService(host);
    expect(service).toBeDefined();
    // Legacy adapter always returns [] for getDiagnostics
    expect(service!.getDiagnostics('/test.ts')).toStrictEqual([]);
  });

  it('waitForDiagnostics preserves empty diagnostics for a clean file', async () => {
    const host = lspCapableHost(async () => []);
    const service = getLegacyLspService(host)!;
    const diags = await service.waitForDiagnostics('/test.ts', 1000);
    expect(diags).toStrictEqual([]);
  });
});

describe('getEmojiFilter', () => {
  it('reads emojifilter from ephemeral settings', () => {
    const host = plainHost({
      readExecutionPolicy: () => ({ emojifilter: 'allowed' }),
    });
    const filter = getEmojiFilter(host);
    // 'allowed' mode passes emoji text through unchanged
    const result = filter.filterText('hello 🎉');
    expect(result.emojiDetected).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it('defaults to error mode when no emojifilter setting is present', () => {
    const host = plainHost({
      readExecutionPolicy: () => ({}),
    });
    const filter = getEmojiFilter(host);
    // Default maps to 'error', which blocks emoji-containing text
    const result = filter.filterText('hello 🎉');
    expect(result.emojiDetected).toBe(true);
    expect(result.blocked).toBe(true);
  });
});
