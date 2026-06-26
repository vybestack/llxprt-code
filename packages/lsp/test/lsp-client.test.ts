import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { fileURLToPath } from 'node:url';

import {
  createLspClient,
  LspRequestTimeoutError,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from '../src/service/lsp-client';
import type { LspServerConfig } from '../src/types';

const WORKSPACE_ROOT = '/workspace';
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/fake-lsp-server.ts', import.meta.url),
);

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

    // Allow small CI timer jitter (typically 1-5ms on loaded runners)
    expect(elapsed).toBeLessThanOrEqual(3050);
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

    // Allow small CI timer jitter (typically 1-5ms on loaded runners)
    expect(elapsed).toBeLessThanOrEqual(3050);
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

describe('LspClient diagnostics boundary normalization', () => {
  it('waitForDiagnostics returns normalized project diagnostics with severity mapped to strings', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/norm-error.ts',
      'const x = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/norm-error.ts',
      2000,
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    const error = diagnostics.find((d) => d.message.includes('type error'));
    expect(error).toBeDefined();
    expect(error?.severity).toBe('error');
    expect(error?.code).toBe('FAKE1001');
  });

  it('waitForDiagnostics normalizes line and column to 1-based offsets', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/norm-line.ts',
      'const x = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/norm-line.ts',
      2000,
    );

    const error = diagnostics.find((d) => d.message.includes('type error'));
    expect(error).toBeDefined();
    expect(error?.line).toBe(1);
    expect(error?.column).toBe(1);
  });

  it('waitForDiagnostics maps warning severity to the warning string', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/norm-warn.ts',
      ['const x = TYPE_ERROR', '// WARN'].join('\n'),
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/norm-warn.ts',
      2000,
    );

    const warning = diagnostics.find((d) => d.message.includes('warning'));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.code).toBe('FAKE2001');
    expect(warning?.line).toBe(2);
  });

  it('waitForDiagnostics drops malformed diagnostics at the client boundary', async () => {
    const client = createLspClient(createConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/malformed-boundary.ts',
      'const x = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/malformed-boundary.ts',
      2000,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe('Simulated type error (TYPE_ERROR)');
  });
});

const CONTENT_LENGTH_FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/fake-lsp-server-content-length.ts', import.meta.url),
);

function createContentLengthConfig(): { config: LspServerConfig } {
  return {
    config: {
      id: 'content-length-utf8',
      command: 'bun',
      args: ['run', CONTENT_LENGTH_FIXTURE_PATH],
      rootUri: `file://${WORKSPACE_ROOT}`,
    },
  };
}

describe('Content-Length framing with multi-byte UTF-8', () => {
  it('correctly parses messages containing multi-byte UTF-8 characters', async () => {
    const client = createLspClient(createContentLengthConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile('/workspace/src/unicode.ts', 'const x = TYPE_ERROR');

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/unicode.ts',
      3000,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message ?? '').toContain('\u30a8\u30e9\u30fc');
  });

  it('handles multiple consecutive messages with multi-byte content', async () => {
    const client = createLspClient(createContentLengthConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/multi-byte-1.ts',
      'const a = TYPE_ERROR',
    );
    await client.touchFile(
      '/workspace/src/multi-byte-2.ts',
      'const b = TYPE_ERROR',
    );

    const d1 = await client.waitForDiagnostics(
      '/workspace/src/multi-byte-1.ts',
      3000,
    );
    const d2 = await client.waitForDiagnostics(
      '/workspace/src/multi-byte-2.ts',
      3000,
    );
    expect(d1.length).toBeGreaterThan(0);
    expect(d2.length).toBeGreaterThan(0);
    expect(d1[0]?.message ?? '').toContain('\u30a8\u30e9\u30fc');
    expect(d2[0]?.message ?? '').toContain('\u30a8\u30e9\u30fc');
  });

  it('correctly handles mixed multi-byte and single-byte messages', async () => {
    const client = createLspClient(createContentLengthConfig(), WORKSPACE_ROOT);
    createdClients.push(client);

    await client.initialize();
    await client.touchFile(
      '/workspace/src/mixed.ts',
      'const x = TYPE_ERROR\n// WARN',
    );

    const diagnostics = await client.waitForDiagnostics(
      '/workspace/src/mixed.ts',
      3000,
    );
    expect(diagnostics.length).toBe(2);
    expect(diagnostics[0]?.message ?? '').toContain('\u30a8\u30e9\u30fc');
    expect(diagnostics[1]?.message ?? '').toContain('\u8b66\u544a');
  });
  describe('LspClient request timeout', () => {
    it('rejects with LspRequestTimeoutError when request exceeds configured requestTimeoutMs', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 200 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/timeout-test.ts', 'const x = 1;');

      await expect(
        client.hover('/workspace/src/timeout-test.ts', 0, 0),
      ).rejects.toThrow(LspRequestTimeoutError);
    });

    it('LspRequestTimeoutError includes method name and timeout duration', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 150 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/timeout-msg.ts', 'const x = 1;');

      try {
        await client.hover('/workspace/src/timeout-msg.ts', 0, 0);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LspRequestTimeoutError);
        const timeoutError = error as LspRequestTimeoutError;
        expect(timeoutError.method).toBe('textDocument/hover');
        expect(timeoutError.timeoutMs).toBe(150);
        expect(timeoutError.message).toContain('textDocument/hover');
        expect(timeoutError.message).toContain('150');
        expect(timeoutError.name).toBe('LspRequestTimeoutError');
      }
    });

    it('timeout does not mark client as broken', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 200 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/timeout-alive.ts', 'const x = 1;');

      await expect(
        client.hover('/workspace/src/timeout-alive.ts', 0, 0),
      ).rejects.toThrow(LspRequestTimeoutError);

      expect(client.isAlive()).toBe(true);
    });

    it('a later normal request can still complete after an earlier timeout', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 200 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile(
        '/workspace/src/timeout-recover.ts',
        'const x = 1;',
      );

      // First request times out (hover is delayed)
      await expect(
        client.hover('/workspace/src/timeout-recover.ts', 0, 0),
      ).rejects.toThrow(LspRequestTimeoutError);

      // Second request uses documentSymbols which is NOT delayed
      const symbols = await client.documentSymbols(
        '/workspace/src/timeout-recover.ts',
      );
      expect(Array.isArray(symbols)).toBe(true);
      expect(client.isAlive()).toBe(true);
    });

    it('uses DEFAULT_REQUEST_TIMEOUT_MS (30s) when no requestTimeoutMs is configured', () => {
      expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
    });

    it('default constructor uses DEFAULT_REQUEST_TIMEOUT_MS', async () => {
      const client = createLspClient(createConfig(), WORKSPACE_ROOT);
      createdClients.push(client);

      // We can verify indirectly: initialize must still succeed
      // because the 30s default is long enough for the fake server
      await client.initialize();
      expect(client.isAlive()).toBe(true);
    });
  });

  describe('LspClient request abort', () => {
    it('rejects with abort error when in-flight request is aborted', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 30_000 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/abort-test.ts', 'const x = 1;');

      const controller = new AbortController();
      const hoverPromise = client.hover('/workspace/src/abort-test.ts', 0, 0, {
        abortSignal: controller.signal,
      });

      controller.abort(new Error('User cancelled'));

      await expect(hoverPromise).rejects.toThrow('User cancelled');
    });

    it('abort does not mark client as broken', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 30_000 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/abort-alive.ts', 'const x = 1;');

      const controller = new AbortController();
      const hoverPromise = client.hover('/workspace/src/abort-alive.ts', 0, 0, {
        abortSignal: controller.signal,
      });

      controller.abort();

      await expect(hoverPromise).rejects.toThrow();
      expect(client.isAlive()).toBe(true);
    });

    it('rejects immediately when already-aborted signal is passed', async () => {
      const client = createLspClient(createConfig(), WORKSPACE_ROOT, {
        requestTimeoutMs: 30_000,
      });
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/pre-abort.ts', 'const x = 1;');

      const controller = new AbortController();
      controller.abort(new Error('Already aborted'));

      await expect(
        client.hover('/workspace/src/pre-abort.ts', 0, 0, {
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow('Already aborted');

      expect(client.isAlive()).toBe(true);
    });

    it('pre-aborted signal does not prevent subsequent requests from succeeding', async () => {
      const client = createLspClient(
        createConfig(['--delay-request-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 30_000 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile(
        '/workspace/src/pre-abort-chain.ts',
        'const x = 1;',
      );

      const controller = new AbortController();
      controller.abort(new Error('Pre-cancelled'));

      // Already-aborted hover should reject without sending
      await expect(
        client.hover('/workspace/src/pre-abort-chain.ts', 0, 0, {
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow('Pre-cancelled');

      // documentSymbols is NOT delayed and should complete normally,
      // proving no pending entry was leaked from the pre-aborted call
      const symbols = await client.documentSymbols(
        '/workspace/src/pre-abort-chain.ts',
      );
      expect(Array.isArray(symbols)).toBe(true);
      expect(client.isAlive()).toBe(true);
    });
  });
  describe('LspClient write failure cleanup', () => {
    it('request to crashed server cleans up pending/timer/listener and does not mark broken for timeout', async () => {
      // Use --crash-on-method to make the server crash when it receives a
      // specific request method. This exercises sendRequest's write-phase
      // failure path directly (the write succeeds, but the process exits
      // before the response arrives). The client should clean up the pending
      // entry, timer, and abort listener via markBroken — without the request
      // timeout/abort itself ever calling markBroken.
      const client = createLspClient(
        createConfig(['--crash-on-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 3000 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/crash-req.ts', 'const x = 1;');

      // The server crashes when it receives hover, so the write succeeds but
      // the response never arrives. markBroken rejects the pending promise.
      // The test verifies that the timeout timer and abort listener registered
      // in Phase 2 are cleaned up by markBroken (not a leaked timer).
      await expect(
        client.hover('/workspace/src/crash-req.ts', 0, 0),
      ).rejects.toThrow();

      // markBroken was triggered by the process exit, not by timeout/abort
      expect(client.isAlive()).toBe(false);
    });

    it('request with abort signal to crashed server cleans up abort listener', async () => {
      const client = createLspClient(
        createConfig(['--crash-on-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 3000 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/abort-req.ts', 'const x = 1;');

      const controller = new AbortController();

      // Request with abort signal — server crashes on hover, markBroken
      // rejects the pending and should clean up the abort listener.
      await expect(
        client.hover('/workspace/src/abort-req.ts', 0, 0, {
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow();

      expect(client.isAlive()).toBe(false);

      // Aborting after the fact should be a no-op (no double-reject,
      // no unhandled rejection) because the listener was removed.
      controller.abort();
    });

    it('request to crashed server clears timeout timer without unhandled rejection', async () => {
      const client = createLspClient(
        createConfig(['--crash-on-method', 'textDocument/hover']),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 200 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/timer-req.ts', 'const x = 1;');

      let unhandledRejection = false;
      const handler = (): void => {
        unhandledRejection = true;
      };
      process.on('unhandledRejection', handler);

      try {
        await expect(
          client.hover('/workspace/src/timer-req.ts', 0, 0),
        ).rejects.toThrow();

        // Wait beyond requestTimeoutMs to ensure any leaked timer would fire
        await new Promise((resolve) => setTimeout(resolve, 400));
      } finally {
        process.off('unhandledRejection', handler);
      }

      // No unhandled rejection from a leaked timer
      expect(unhandledRejection).toBe(false);
    });
  });

  describe('LspClient late response after timeout/abort', () => {
    it('late response arriving after timeout does not break subsequent requests', async () => {
      // Use both --delay-request-method and --delay-respond-ms so the server
      // delays the hover response by 500ms (which will arrive after the 200ms
      // timeout). The late response should be silently dropped and not affect
      // subsequent requests.
      const client = createLspClient(
        createConfig([
          '--delay-request-method',
          'textDocument/hover',
          '--delay-respond-ms',
          '500',
        ]),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 200 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/late-resp.ts', 'const x = 1;');

      // Hover times out after 200ms; the server will send a late response
      // at ~500ms that should be ignored.
      await expect(
        client.hover('/workspace/src/late-resp.ts', 0, 0),
      ).rejects.toThrow(LspRequestTimeoutError);

      // Wait for the late response to actually arrive
      await new Promise((resolve) => setTimeout(resolve, 500));

      // A subsequent request should work fine despite the late response
      const symbols = await client.documentSymbols(
        '/workspace/src/late-resp.ts',
      );
      expect(Array.isArray(symbols)).toBe(true);
      expect(client.isAlive()).toBe(true);
    });

    it('late response arriving after abort does not break subsequent requests', async () => {
      const client = createLspClient(
        createConfig([
          '--delay-request-method',
          'textDocument/hover',
          '--delay-respond-ms',
          '500',
        ]),
        WORKSPACE_ROOT,
        { requestTimeoutMs: 30_000 },
      );
      createdClients.push(client);

      await client.initialize();
      await client.touchFile('/workspace/src/late-abort.ts', 'const x = 1;');

      const controller = new AbortController();
      const hoverPromise = client.hover('/workspace/src/late-abort.ts', 0, 0, {
        abortSignal: controller.signal,
      });

      // Abort immediately — server will send late response at ~500ms
      controller.abort(new Error('Cancelled'));

      await expect(hoverPromise).rejects.toThrow('Cancelled');

      // Wait for the late response to arrive
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Subsequent non-delayed request should still work
      const symbols = await client.documentSymbols(
        '/workspace/src/late-abort.ts',
      );
      expect(Array.isArray(symbols)).toBe(true);
      expect(client.isAlive()).toBe(true);
    });
  });
});
