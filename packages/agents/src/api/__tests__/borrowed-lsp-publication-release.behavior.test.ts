import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@vybestack/llxprt-code-core';
import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner, toConfigParameters } from '../../index.js';

const fixture = fileURLToPath(
  new URL('../../../../lsp/test/fixtures/fake-lsp-server.ts', import.meta.url),
);

async function exercise(callerFirst: boolean): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'borrowed-lsp-publication-'));
  const file = join(directory, 'input.ts');
  await writeFile(file, 'const value = TYPE_ERROR;\n');
  const config = new Config(
    toConfigParameters({
      provider: 'openai',
      model: 'local-only',
      workingDir: directory,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      telemetry: { enabled: false },
      recording: { enabled: false },
    }),
  );
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const lsp = new WorkspaceLspOwner(
    { servers: [{ id: 'ts', command: process.execPath, args: [fixture] }] },
    directory,
    () => trust.isTrustedFolder(),
  );
  const root = await McpRuntimeOwner.create(
    {
      openBrowser: async () => {
        throw new Error('Unexpected browser');
      },
      tokenStorage: new MCPOAuthTokenStorage({
        getCredentials: async () => null,
        setCredentials: async () => {
          throw new Error('Unexpected credential write');
        },
        deleteCredentials: async () => {},
        listServers: async () => [],
        getAllCredentials: async () => new Map(),
        clearAll: async () => {},
      }),
    },
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    lsp,
    'caller',
    undefined,
    'runtime',
    undefined,
    undefined,
    'runtime',
    trust,
  );
  try {
    await root.initialize();
    expect(
      root.toolSelection
        .getAllToolNames()
        .some((name) => name.includes('lsp_hover')),
    ).toBe(true);
    if (callerFirst) {
      await lsp.dispose();
      expect(
        root.toolSelection
          .getAllToolNames()
          .some((name) => name.includes('lsp_hover')),
      ).toBe(false);
      await root.dispose();
    } else {
      await root.dispose();
      expect((await lsp.inspection.read()).alive).toBe(true);
      expect(
        (await lsp.diagnostics.waitForDiagnostics(file, 5000)).some((entry) =>
          entry.message.includes('Simulated type error'),
        ),
      ).toBe(true);
      await expect(lsp.dispose()).resolves.toBeUndefined();
    }
    await expect(lsp.inspection.read()).rejects.toThrow('stopped');
  } finally {
    await cleanup(root, lsp, config, directory);
    await trust.dispose();
  }
}

async function cleanup(
  root: McpRuntimeOwner,
  lsp: WorkspaceLspOwner,
  config: Config,
  directory: string,
): Promise<void> {
  const settled = await Promise.allSettled([
    root.dispose(),
    lsp.dispose(),
    config.dispose(),
  ]);
  await rm(directory, { recursive: true, force: true });
  const failures = settled.flatMap((entry) =>
    entry.status === 'rejected' ? [entry.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Fixture cleanup failed');
}

describe('caller LSP publication lifetime through the public workspace root', () => {
  it('releases the workspace publication before the surviving caller LSP closes', async () => {
    await expect(exercise(false)).resolves.toBeUndefined();
  });
  it('allows the caller LSP to close before the borrowing workspace', async () => {
    await expect(exercise(true)).resolves.toBeUndefined();
  });
});
