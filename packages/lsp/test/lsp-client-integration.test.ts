import { afterEach, describe, expect, it } from 'vitest';

import { createLspClient } from '../src/service/lsp-client';
import type { LspServerConfig } from '../src/types';

const WORKSPACE_ROOT = '/workspace';
const FIXTURE_PATH = new URL('./fixtures/fake-lsp-server.ts', import.meta.url)
  .pathname;

function createConfig(args: string[] = []): { config: LspServerConfig } {
  return {
    config: {
      id: 'fake-ts',
      command: process.execPath,
      args: [FIXTURE_PATH, ...args],
      rootUri: `file://${WORKSPACE_ROOT}`,
    },
  };
}

const createdClients: Array<ReturnType<typeof createLspClient>> = [];

afterEach(async () => {
  await Promise.all(
    createdClients.map(async (client) => {
      try {
        await client.shutdown();
      } catch {
        // ignore cleanup errors in failing-stub phase
      }
    }),
  );
  createdClients.length = 0;
});

describe('LspClient integration with fake LSP server', () => {
  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Initialize handshake with fake LSP server
   * @given:A fake LSP server configured to respond to initialize
   * @when:LspClient.initialize() is called
   * @then:Client successfully completes handshake and isAlive() returns true
   */
  it('completes initialize handshake with fake server', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await expect(client.initialize()).resolves.toBeUndefined();
    expect(client.isAlive()).toBe(true);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:First touch sends didOpen and receives diagnostics
   * @given:An initialized client and a new file containing TYPE_ERROR marker
   * @when:touchFile is called the first time and diagnostics are awaited
   * @then:publishDiagnostics payload is surfaced as non-empty diagnostics
   */
  it('sends didOpen on first touch and receives diagnostics', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/a.ts', 'const x = TYPE_ERROR');

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/a.ts',
      800,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Second touch of same file sends didChange
   * @given:An initialized client with an already-open file
   * @when:touchFile is called again with updated content
   * @then:Updated diagnostics are returned for the same file
   */
  it('uses didChange for subsequent touches on an open file', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/b.ts', 'const x = TYPE_ERROR');
    await client.waitForDiagnostics('/workspace/src/b.ts', 800);

    await client.touchFile(
      '/workspace/src/b.ts',
      'const x = TYPE_ERROR\n// WARN',
    );
    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/b.ts',
      800,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-TIME-050
   * @scenario:Debounce settles on final diagnostics
   * @given:Rapid successive didChange events for one file
   * @when:waitForDiagnostics is called after rapid updates
   * @then:Final settled diagnostic set is returned
   */
  it('settles diagnostics after rapid successive touches', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/c.ts', 'const x = TYPE_ERROR');
    await client.touchFile(
      '/workspace/src/c.ts',
      'const x = TYPE_ERROR\n// WARN',
    );
    await client.touchFile(
      '/workspace/src/c.ts',
      'const x = TYPE_ERROR\n// WARN\nconst y = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/c.ts',
      1200,
    );
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-070
   * @scenario:Server crash marks client as broken
   * @given:Server configured to crash on didOpen
   * @when:touchFile triggers crash
   * @then:Client reports not alive after crash
   */
  it('marks client broken after server crash', async () => {
    const client = createLspClient(
      createConfig(['--crash-on-did-open']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/crash.ts', 'const x = TYPE_ERROR');

    expect(client.isAlive()).toBe(false);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Shutdown sends shutdown and exit to server
   * @given:An initialized client
   * @when:shutdown is invoked
   * @then:Client terminates server session and reports not alive
   */
  it('shuts down gracefully after initialize', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await expect(client.shutdown()).resolves.toBeUndefined();
    expect(client.isAlive()).toBe(false);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-TIME-050
   * @scenario:waitForDiagnostics timeout returns empty list
   * @given:An initialized client and no diagnostic notification for file
   * @when:waitForDiagnostics times out
   * @then:Returns empty diagnostics instead of throwing
   */
  it('returns empty diagnostics on timeout', async () => {
    const client = createLspClient(
      createConfig(['--delay-ms', '500']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/never-opened.ts',
      20,
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Rapid touches across multiple files are handled
   * @given:An initialized client with two files touched rapidly
   * @when:Diagnostics are awaited for both files
   * @then:Each file can return diagnostics without protocol deadlock
   */
  it('handles rapid touches across multiple files', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();

    await Promise.all([
      client.touchFile('/workspace/src/f1.ts', 'const x = TYPE_ERROR'),
      client.touchFile('/workspace/src/f2.ts', 'const x = TYPE_ERROR\n// WARN'),
    ]);

    const [d1, d2] = await Promise.all([
      client.waitForDiagnostics('/workspace/src/f1.ts', 800),
      client.waitForDiagnostics('/workspace/src/f2.ts', 800),
    ]);

    expect(d1.length).toBeGreaterThan(0);
    expect(d2.length).toBeGreaterThan(0);
  });
});
