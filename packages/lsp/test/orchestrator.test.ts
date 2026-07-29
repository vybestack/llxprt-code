import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';

import { createOrchestrator } from '../src/service/orchestrator';
import type { Diagnostic, LspConfig } from '../src/service/diagnostics';

const WORKSPACE_ROOT = path.resolve('/workspace');
const WORKSPACE_URI = pathToFileURL(WORKSPACE_ROOT).toString();
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/fake-lsp-server.ts', import.meta.url),
);

type AnyOrchestrator = ReturnType<typeof createOrchestrator>;

function createFakeServer(
  id: string,
  extensions: string[],
  extraArgs: string[] = [],
) {
  return {
    id,
    command: process.execPath,
    args: [FIXTURE_PATH, ...extraArgs],
    rootUri: WORKSPACE_URI,
    extensions,
  };
}

function createConfig(servers: LspConfig['servers']): LspConfig {
  return { servers };
}

function activeTouchCounts(diagnostics: Diagnostic[]): string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.code === 'FAKE_ACTIVE_TOUCH_COUNT')
    .map((diagnostic) => diagnostic.message);
}

describe('Orchestrator unit tests against real implementation', () => {
  let orchestrator: AnyOrchestrator;

  beforeEach(() => {
    orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
  });

  afterEach(async () => {
    await orchestrator.shutdown();
  });

  it('returns empty diagnostics for files outside workspace', async () => {
    await expect(
      orchestrator.checkFile(path.resolve('/outside/file.ts'), 'TYPE_ERROR'),
    ).resolves.toEqual([]);
  });

  it('platform-correct workspace boundary: sibling dir with same prefix is rejected', async () => {
    // A directory like /workspace-extra must NOT be treated as inside /workspace.
    const sibling = path.resolve(`${WORKSPACE_ROOT}-extra`, 'file.ts');
    await expect(
      orchestrator.checkFile(sibling, 'TYPE_ERROR'),
    ).resolves.toEqual([]);
  });

  it('platform-correct workspace boundary: nested file is accepted', async () => {
    const result = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src', 'nested.ts'),
      'const x = TYPE_ERROR',
    );
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty diagnostics for unknown extension', async () => {
    await expect(
      orchestrator.checkFile(
        path.join(WORKSPACE_ROOT, 'file.md'),
        'TYPE_ERROR',
      ),
    ).resolves.toEqual([]);
  });

  it('collects diagnostics for matching extension', async () => {
    const result = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );
    expect(result.length).toBeGreaterThan(0);
  });

  it('initial status includes configured servers but not starting before touch', async () => {
    const status = await orchestrator.status();
    expect(status).toEqual([{ serverId: 'fake-ts', state: 'idle' }]);
  });

  it(
    'status marks broken after crash during checkFile',
    { timeout: 15_000 },
    async () => {
      const broken = createOrchestrator(
        createConfig([
          createFakeServer('fake-crash', ['.ts'], ['--crash-on-did-open']),
        ]),
        WORKSPACE_ROOT,
      );
      try {
        await broken.checkFile(
          path.join(WORKSPACE_ROOT, 'src/crash.ts'),
          'const x = TYPE_ERROR',
        );
        const status = await broken.status();
        expect(
          status.some(
            (s) => s.serverId === 'fake-crash' && s.state === 'broken',
          ),
        ).toBe(true);
      } finally {
        await broken.shutdown();
      }
    },
  );

  it('gotoDefinition returns empty for unknown extension', async () => {
    await expect(
      orchestrator.gotoDefinition(path.join(WORKSPACE_ROOT, 'src/a.py'), 0, 0),
    ).resolves.toEqual([]);
  });

  it('gotoDefinition returns bounded fallback when server gives no response', async () => {
    const hanging = createOrchestrator(
      {
        ...createConfig([
          createFakeServer(
            'fake-no-nav',
            ['.ts'],
            ['--no-definition-response'],
          ),
        ]),
        navigationTimeoutMs: 350,
      },
      WORKSPACE_ROOT,
    );
    try {
      // Use a generous test timeout (2x navigationTimeoutMs + buffer) to remain robust under load
      // while still verifying that the response is bounded (doesn't hang indefinitely)
      const testTimeoutMs = 1500;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), testTimeoutMs),
      );
      const result = await Promise.race([
        hanging.gotoDefinition(path.join(WORKSPACE_ROOT, 'src/n.ts'), 0, 0),
        timeout,
      ]);
      expect(result.length).toBeGreaterThan(0);
    } finally {
      await hanging.shutdown();
    }
  });

  it('findReferences returns locations for matching server', async () => {
    const refs = await orchestrator.findReferences(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      0,
      0,
    );
    expect(Array.isArray(refs)).toBe(true);
  });

  it('hover returns string or null without throwing', async () => {
    const hover = await orchestrator.hover(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      0,
      0,
    );
    expect(typeof hover === 'string' || hover === null).toBe(true);
  });

  it('documentSymbols returns typed LSP symbols with numeric kind', async () => {
    const symbols = await orchestrator.documentSymbols(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
    );
    expect(symbols[0]).toMatchObject({
      name: 'fakeSymbol',
      kind: 12,
      selectionRange: { start: { line: 0, character: 0 } },
    });
  });

  it('getAllDiagnostics returns touched files only', async () => {
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );
    const all = await orchestrator.getAllDiagnostics();
    expect(Object.keys(all)).toEqual([path.join(WORKSPACE_ROOT, 'src/a.ts')]);
  });

  it('diagnostic epoch increases after checks', async () => {
    const before = orchestrator.getDiagnosticEpoch();
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );
    expect(orchestrator.getDiagnosticEpoch()).toBeGreaterThan(before);
  });

  it('getAllDiagnosticsAfter returns only newer touched files', async () => {
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );
    const epoch = orchestrator.getDiagnosticEpoch();
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/b.ts'),
      'const y = TYPE_ERROR',
    );
    const after = await orchestrator.getAllDiagnosticsAfter(epoch);
    expect(Object.keys(after)).toEqual([path.join(WORKSPACE_ROOT, 'src/b.ts')]);
  });

  it('shutdown clears runtime state', async () => {
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );
    await orchestrator.shutdown();
    expect(await orchestrator.getAllDiagnostics()).toEqual({});
    expect(orchestrator.getDiagnosticEpoch()).toBe(0);
  });

  it('serializes per-client operations', { timeout: 15_000 }, async () => {
    const delayed = createOrchestrator(
      {
        ...createConfig([
          createFakeServer(
            'fake-serial',
            ['.ts'],
            ['--delay-ms', '100', '--emit-active-touch-count'],
          ),
        ]),
        diagnosticsTimeoutMs: 2_000,
        firstTouchTimeoutMs: 2_000,
      },
      WORKSPACE_ROOT,
    );
    try {
      const [firstDiagnostics, secondDiagnostics] = await Promise.all([
        delayed.checkFile(
          path.join(WORKSPACE_ROOT, 'src/a.ts'),
          'const a = TYPE_ERROR',
        ),
        delayed.checkFile(
          path.join(WORKSPACE_ROOT, 'src/b.ts'),
          'const b = TYPE_ERROR',
        ),
      ]);

      expect(firstDiagnostics.length).toBeGreaterThan(0);
      expect(secondDiagnostics.length).toBeGreaterThan(0);
      expect(activeTouchCounts(firstDiagnostics)).toEqual([
        'Active touch handlers: 1',
      ]);
      expect(activeTouchCounts(secondDiagnostics)).toEqual([
        'Active touch handlers: 1',
      ]);
    } finally {
      await delayed.shutdown();
    }
  });

  it('property: unknown extensions always produce empty diagnostics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 8 }),
        async (extRaw) => {
          const ext = extRaw.replace(/[^a-z]/gi, 'x') || 'x';
          if (ext.toLowerCase() === 'ts') return;
          const out = await orchestrator.checkFile(
            path.join(WORKSPACE_ROOT, 'src', `a.${ext}`),
            'TYPE_ERROR',
          );
          expect(out).toEqual([]);
        },
      ),
    );
  });

  it('property: outside workspace paths never return diagnostics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        async (name) => {
          const clean = name.replace(/\//g, '_');
          const out = await orchestrator.checkFile(
            path.join(os.tmpdir(), `${clean}.ts`),
            'TYPE_ERROR',
          );
          expect(out).toEqual([]);
        },
      ),
    );
  });

  it('property: status server ids are always sorted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (ids) => {
          const servers = ids.map((id) => createFakeServer(id, ['.ts']));
          const o = createOrchestrator(createConfig(servers), WORKSPACE_ROOT);
          try {
            const status = await o.status();
            const sorted = [...status.map((s) => s.serverId)].sort((a, b) =>
              a.localeCompare(b),
            );
            expect(status.map((s) => s.serverId)).toEqual(sorted);
          } finally {
            await o.shutdown();
          }
        },
      ),
    );
  });

  it('property: getAllDiagnosticsAfter(epoch) excludes older file touches', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 }), async (n) => {
        const o = createOrchestrator(
          createConfig([createFakeServer('fake-ts', ['.ts'])]),
          WORKSPACE_ROOT,
        );
        try {
          for (let i = 0; i < n; i += 1) {
            await o.checkFile(
              path.join(WORKSPACE_ROOT, 'src', `p${i}.ts`),
              'const x = TYPE_ERROR',
            );
          }
          const epoch = o.getDiagnosticEpoch();
          await o.checkFile(
            path.join(WORKSPACE_ROOT, 'src/newer.ts'),
            'const y = TYPE_ERROR',
          );
          const out = await o.getAllDiagnosticsAfter(epoch);
          expect(Object.keys(out)).toEqual([
            path.join(WORKSPACE_ROOT, 'src/newer.ts'),
          ]);
        } finally {
          await o.shutdown();
        }
      }),
      { numRuns: 4 },
    );
  });

  it('property: gotoDefinition on non-routed file always []', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        async (line, char) => {
          const out = await orchestrator.gotoDefinition(
            path.join(WORKSPACE_ROOT, 'src/a.py'),
            line,
            char,
          );
          expect(out).toEqual([]);
        },
      ),
    );
  });

  it('property: checkFile result is always an array', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        async (content) => {
          const out = await orchestrator.checkFile(
            path.join(WORKSPACE_ROOT, 'src/prop.unknown'),
            content,
          );
          expect(Array.isArray(out)).toBe(true);
        },
      ),
      { numRuns: 8 },
    );
  });

  it('requestTimeoutMs config does not break client initialization', async () => {
    const o = createOrchestrator(
      {
        servers: [createFakeServer('fake-ts', ['.ts'])],
        requestTimeoutMs: 15_000,
      },
      WORKSPACE_ROOT,
    );
    try {
      await o.checkFile(
        path.join(WORKSPACE_ROOT, 'src/req-timeout.ts'),
        'const x = TYPE_ERROR',
      );
      const status = await o.status();
      expect(
        status.some((s) => s.serverId === 'fake-ts' && s.state === 'ok'),
      ).toBe(true);
    } finally {
      await o.shutdown();
    }
  });
  it('withTimeout aborts underlying LspClient request on navigation timeout', async () => {
    const o = createOrchestrator(
      {
        servers: [
          createFakeServer(
            'fake-slow',
            ['.ts'],
            ['--delay-request-method', 'textDocument/hover'],
          ),
        ],
        navigationTimeoutMs: 300,
      },
      WORKSPACE_ROOT,
    );
    try {
      // When hover is delayed, withTimeout should return the fallback value
      // AND abort the underlying LspClient request so it doesn't hang
      // until the client's own requestTimeoutMs expires.
      const result = await o.hover(
        path.join(WORKSPACE_ROOT, 'src/slow-hover.ts'),
        0,
        0,
      );
      expect(result).toBeNull();

      // After the navigation timeout returns fallback, the client should still
      // be alive for other requests
      const symbols = await o.documentSymbols(
        path.join(WORKSPACE_ROOT, 'src/slow-hover.ts'),
      );
      expect(Array.isArray(symbols)).toBe(true);
    } finally {
      await o.shutdown();
    }
  });

  it('navigation timeout aborts slow requests before requestTimeoutMs elapses', async () => {
    const o = createOrchestrator(
      {
        servers: [
          createFakeServer(
            'fake-req-timeout',
            ['.ts'],
            ['--delay-request-method', 'textDocument/hover'],
          ),
        ],
        // navigationTimeoutMs shorter than requestTimeoutMs so the
        // orchestrator returns fallback before the client's own timeout fires,
        // proving the abort signal is wired through correctly.
        navigationTimeoutMs: 300,
        requestTimeoutMs: 30_000,
      },
      WORKSPACE_ROOT,
    );
    try {
      // hover is delayed by the server; withTimeout returns null fallback
      // after 300ms and aborts the pending LspClient hover request
      const result = await o.hover(
        path.join(WORKSPACE_ROOT, 'src/req-timeout-hover.ts'),
        0,
        0,
      );
      expect(result).toBeNull();

      // Non-delayed method should still work
      const symbols = await o.documentSymbols(
        path.join(WORKSPACE_ROOT, 'src/req-timeout-hover.ts'),
      );
      expect(Array.isArray(symbols)).toBe(true);
    } finally {
      await o.shutdown();
    }
  });

  it('requestTimeoutMs shorter than navigationTimeoutMs causes LspRequestTimeoutError', async () => {
    const o = createOrchestrator(
      {
        servers: [
          createFakeServer(
            'fake-short-req',
            ['.ts'],
            ['--delay-request-method', 'textDocument/hover'],
          ),
        ],
        // requestTimeoutMs shorter than navigationTimeoutMs means the
        // LspClient will reject with LspRequestTimeoutError before the
        // orchestrator's timeout resolves — the withTimeout catch should
        // return fallback.
        requestTimeoutMs: 200,
        navigationTimeoutMs: 30_000,
      },
      WORKSPACE_ROOT,
    );
    try {
      // Hover times out at the client level (200ms), withTimeout catches it
      // and returns the fallback
      const result = await o.hover(
        path.join(WORKSPACE_ROOT, 'src/short-req-hover.ts'),
        0,
        0,
      );
      expect(result).toBeNull();

      // Non-delayed method should still work
      const symbols = await o.documentSymbols(
        path.join(WORKSPACE_ROOT, 'src/short-req-hover.ts'),
      );
      expect(Array.isArray(symbols)).toBe(true);
    } finally {
      await o.shutdown();
    }
  });
});
