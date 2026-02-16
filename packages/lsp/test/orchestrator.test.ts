import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { createOrchestrator } from '../src/service/orchestrator';
import type { LspConfig } from '../src/service/diagnostics';

const WORKSPACE_ROOT = '/workspace';
const FIXTURE_PATH = new URL('./fixtures/fake-lsp-server.ts', import.meta.url)
  .pathname;

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
    rootUri: `file://${WORKSPACE_ROOT}`,
    extensions,
  };
}

function createConfig(servers: LspConfig['servers']): LspConfig {
  return { servers };
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
      orchestrator.checkFile('/outside/file.ts', 'TYPE_ERROR'),
    ).resolves.toEqual([]);
  });

  it('returns empty diagnostics for unknown extension', async () => {
    await expect(
      orchestrator.checkFile('/workspace/file.md', 'TYPE_ERROR'),
    ).resolves.toEqual([]);
  });

  it('collects diagnostics for matching extension', async () => {
    const result = await orchestrator.checkFile(
      '/workspace/src/a.ts',
      'const x = TYPE_ERROR',
    );
    expect(result.length).toBeGreaterThan(0);
  });

  it('initial status includes configured servers but not starting before touch', async () => {
    const status = await orchestrator.status();
    expect(status).toEqual([{ serverId: 'fake-ts', state: 'idle' }]);
  });

  it('status marks broken after crash during checkFile', async () => {
    const broken = createOrchestrator(
      createConfig([
        createFakeServer('fake-crash', ['.ts'], ['--crash-on-did-open']),
      ]),
      WORKSPACE_ROOT,
    );
    try {
      await broken.checkFile('/workspace/src/crash.ts', 'const x = TYPE_ERROR');
      const status = await broken.status();
      expect(
        status.some((s) => s.serverId === 'fake-crash' && s.state === 'broken'),
      ).toBe(true);
    } finally {
      await broken.shutdown();
    }
  });

  it('gotoDefinition returns empty for unknown extension', async () => {
    await expect(
      orchestrator.gotoDefinition('/workspace/src/a.py', 0, 0),
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
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 700),
      );
      const result = await Promise.race([
        hanging.gotoDefinition('/workspace/src/n.ts', 0, 0),
        timeout,
      ]);
      expect(result.length).toBeGreaterThan(0);
    } finally {
      await hanging.shutdown();
    }
  });

  it('findReferences returns locations for matching server', async () => {
    const refs = await orchestrator.findReferences('/workspace/src/a.ts', 0, 0);
    expect(Array.isArray(refs)).toBe(true);
  });

  it('hover returns string or null without throwing', async () => {
    const hover = await orchestrator.hover('/workspace/src/a.ts', 0, 0);
    expect(typeof hover === 'string' || hover === null).toBe(true);
  });

  it('documentSymbols returns array', async () => {
    const symbols = await orchestrator.documentSymbols('/workspace/src/a.ts');
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('getAllDiagnostics returns touched files only', async () => {
    await orchestrator.checkFile('/workspace/src/a.ts', 'const x = TYPE_ERROR');
    const all = await orchestrator.getAllDiagnostics();
    expect(Object.keys(all)).toEqual(['/workspace/src/a.ts']);
  });

  it('diagnostic epoch increases after checks', async () => {
    const before = orchestrator.getDiagnosticEpoch();
    await orchestrator.checkFile('/workspace/src/a.ts', 'const x = TYPE_ERROR');
    expect(orchestrator.getDiagnosticEpoch()).toBeGreaterThan(before);
  });

  it('getAllDiagnosticsAfter returns only newer touched files', async () => {
    await orchestrator.checkFile('/workspace/src/a.ts', 'const x = TYPE_ERROR');
    const epoch = orchestrator.getDiagnosticEpoch();
    await orchestrator.checkFile('/workspace/src/b.ts', 'const y = TYPE_ERROR');
    const after = await orchestrator.getAllDiagnosticsAfter(epoch);
    expect(Object.keys(after)).toEqual(['/workspace/src/b.ts']);
  });

  it('shutdown clears runtime state', async () => {
    await orchestrator.checkFile('/workspace/src/a.ts', 'const x = TYPE_ERROR');
    await orchestrator.shutdown();
    expect(await orchestrator.getAllDiagnostics()).toEqual({});
    expect(orchestrator.getDiagnosticEpoch()).toBe(0);
  });

  it('serializes per-client operations', async () => {
    const spy = vi.spyOn(orchestrator as any, 'enqueueClientOp');
    await Promise.all([
      orchestrator.checkFile('/workspace/src/a.ts', 'const a = TYPE_ERROR'),
      orchestrator.checkFile('/workspace/src/a.ts', 'const b = TYPE_ERROR'),
    ]);
    expect(spy).toHaveBeenCalled();
  });

  it('property: unknown extensions always produce empty diagnostics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 8 }),
        async (extRaw) => {
          const ext = extRaw.replace(/[^a-z]/gi, 'x') || 'x';
          if (ext === 'ts') return;
          const out = await orchestrator.checkFile(
            `/workspace/src/a.${ext}`,
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
            `/tmp/${clean}.ts`,
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
              `/workspace/src/p${i}.ts`,
              'const x = TYPE_ERROR',
            );
          }
          const epoch = o.getDiagnosticEpoch();
          await o.checkFile('/workspace/src/newer.ts', 'const y = TYPE_ERROR');
          const out = await o.getAllDiagnosticsAfter(epoch);
          expect(Object.keys(out)).toEqual(['/workspace/src/newer.ts']);
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
            '/workspace/src/a.py',
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
            '/workspace/src/prop.unknown',
            content,
          );
          expect(Array.isArray(out)).toBe(true);
        },
      ),
      { numRuns: 8 },
    );
  });
});
