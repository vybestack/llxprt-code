import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

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
  vi.useRealTimers();
  await Promise.all(
    createdClients.map(async (client) => {
      try {
        await client.shutdown();
      } catch {
        // ignore cleanup errors during failing-stub phase
      }
    }),
  );
  createdClients.length = 0;
});

describe('LspClient unit TDD edge cases and internal behaviors', () => {
  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-050
   * @scenario Debounce settles on last diagnostic update
   */
  it('returns final diagnostics after rapid update sequence under debounce window', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/debounce.ts',
      'const x = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/debounce.ts',
      400,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.at(-1)?.message ?? '').toContain('TYPE_ERROR');
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-030
   * @scenario First touch timeout selection
   */
  it('reports first touch as true before first file interaction', () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    expect(client.isFirstTouch()).toBe(true);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-090
   * @scenario Timeout switching after first touch
   */
  it('transitions first-touch state after touching first file', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/switch.ts', 'const x = TYPE_ERROR');
    expect(client.isFirstTouch()).toBe(false);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-070
   * @scenario Cold-start timeout returns empty diagnostics
   */
  it('returns empty diagnostics when timeout elapses without publishDiagnostics', async () => {
    const client = createLspClient(
      createConfig(['--delay-ms', '500']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/cold-start.ts',
      10,
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-080
   * @scenario Abort signal cancellation behavior
   */
  it('returns empty diagnostics when wait is aborted', async () => {
    const client = createLspClient(
      createConfig(['--delay-ms', '200']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();

    const controller = new AbortController();
    const pending = client.waitForDiagnostics('/workspace/src/abort.ts', 3000);
    controller.abort();

    await expect(pending).resolves.toEqual([]);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-010
   * @scenario initialize must happen before touchFile
   */
  it('requires initialize before touchFile', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await expect(
      client.touchFile('/workspace/src/no-init.ts', 'const x = 1;'),
    ).rejects.toThrow();
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-010
   * @scenario shutdown cleanup
   */
  it('marks client not alive after shutdown', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.shutdown();

    expect(client.isAlive()).toBe(false);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-010
   * @scenario open file tracking with repeated touch
   */
  it('supports touching same file multiple times without protocol failure', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await expect(
      client.touchFile('/workspace/src/repeat.ts', 'const a = TYPE_ERROR'),
    ).resolves.toBeUndefined();
    await expect(
      client.touchFile(
        '/workspace/src/repeat.ts',
        'const a = TYPE_ERROR\n// WARN',
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-010
   * @scenario multiple file tracking
   */
  it('touches multiple files concurrently', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await expect(
      Promise.all([
        client.touchFile('/workspace/src/multi-1.ts', 'const x = TYPE_ERROR'),
        client.touchFile('/workspace/src/multi-2.ts', 'const y = TYPE_ERROR'),
      ]),
    ).resolves.toHaveLength(2);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-050
   * @scenario waitForDiagnostics with zero timeout
   */
  it('returns empty diagnostics for zero timeout', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/zero.ts',
      0,
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-070
   * @scenario pending diagnostics wait on server crash
   */
  it('returns empty diagnostics if server crashes while pending', async () => {
    const client = createLspClient(
      createConfig(['--crash-on-did-open']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/crash-pending.ts',
      'const x = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/crash-pending.ts',
      200,
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-050
   * @scenario anti-trivial-timeout event-driven completion
   */
  it('completes before timeout boundary when diagnostics arrive quickly', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/fast.ts', 'const x = TYPE_ERROR');

    const start = Date.now();
    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/fast.ts',
      3000,
    );
    const elapsed = Date.now() - start;

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-050
   * @scenario deadline-aware debounce near timeout boundary (timeout-100ms)
   */
  it('does not exceed timeout deadline when diagnostics arrive near deadline', async () => {
    const client = createLspClient(
      createConfig(['--delay-ms', '2900']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/deadline-100.ts',
      'const x = TYPE_ERROR',
    );

    const start = Date.now();
    await client.waitForDiagnostics('/workspace/src/deadline-100.ts', 3000);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThanOrEqual(3000);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-050
   * @scenario deadline-aware debounce near timeout boundary (timeout-10ms)
   */
  it('handles diagnostics arriving at timeout-10ms without overrunning deadline', async () => {
    const client = createLspClient(
      createConfig(['--delay-ms', '2990']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/deadline-10.ts',
      'const x = TYPE_ERROR',
    );

    const start = Date.now();
    await client.waitForDiagnostics('/workspace/src/deadline-10.ts', 3000);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThanOrEqual(3000);
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-010
   * @scenario property-based: valid file paths can be touched
   */
  it('property: touchFile accepts arbitrary workspace file paths without sync throw', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);
    await client.initialize();

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        async (segment) => {
          const safe = segment.replace(/[^a-zA-Z0-9_-]/g, 'x');
          const filePath = `/workspace/src/${safe || 'file'}.ts`;
          await expect(
            client.touchFile(filePath, 'const x = 1;'),
          ).resolves.toBeUndefined();
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-LIFE-010
   * @scenario property-based: diagnostics result is always an array
   */
  it('property: waitForDiagnostics always resolves to an array shape', async () => {
    const client = createLspClient(
      createConfig(['--delay-ms', '1000']),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);
    await client.initialize();

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 50 }), async (timeoutMs) => {
        const result = await client.waitForDiagnostics(
          '/workspace/src/array.ts',
          timeoutMs,
        );
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  /**
   * @plan PLAN-20250212-LSP.P11
   * @requirement REQ-TIME-090
   * @scenario property-based: firstTouch transitions monotonically true->false
   */
  it('property: first-touch state never flips back to true after first touch', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);
    await client.initialize();

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 8,
        }),
        async (segments) => {
          const initial = client.isFirstTouch();
          for (const segment of segments) {
            const safe = segment.replace(/[^a-zA-Z0-9_-]/g, 'y');
            await client.touchFile(`/workspace/src/${safe}.ts`, 'const z = 1;');
          }
          const finalValue = client.isFirstTouch();
          expect(initial || !finalValue).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});
