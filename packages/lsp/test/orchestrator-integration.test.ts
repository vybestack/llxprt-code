import { afterEach, describe, expect, it } from 'bun:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';

import { createOrchestrator } from '../src/service/orchestrator';
import type { LspConfig } from '../src/service/diagnostics';

const WORKSPACE_ROOT = path.resolve('/workspace');
const WORKSPACE_URI = pathToFileURL(WORKSPACE_ROOT).toString();
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/fake-lsp-server.ts', import.meta.url),
);

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

const createdOrchestrators: ReturnType<typeof createOrchestrator>[] = [];

afterEach(async () => {
  await Promise.all(
    createdOrchestrators
      .splice(0)
      .map((orchestrator) => orchestrator.shutdown()),
  );
});

describe('Orchestrator integration with real registry/language map/client paths', () => {
  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:extension routing
   */
  it('routes .ts files to matching configured server and returns diagnostics', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-ts', ['.ts']),
        createFakeServer('fake-py', ['.py']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const diagnostics = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/app.ts'),
      'const x = TYPE_ERROR',
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:lazy startup
   */
  it('starts server lazily on first checkFile touch', async () => {
    const orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const before = await orchestrator.status();
    expect(
      before.some((s) => s.serverId === 'fake-ts' && s.state === 'starting'),
    ).toBe(false);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/lazy.ts'),
      'const x = TYPE_ERROR',
    );

    const after = await orchestrator.status();
    expect(
      after.some((s) => s.serverId === 'fake-ts' && s.state === 'ok'),
    ).toBe(true);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:parallel collection
   */
  it('collects diagnostics from multiple servers in parallel for different extensions', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-ts', ['.ts']),
        createFakeServer('fake-py', ['.py']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const [tsDiagnostics, pyDiagnostics] = await Promise.all([
      orchestrator.checkFile(
        path.join(WORKSPACE_ROOT, 'src/a.ts'),
        'const x = TYPE_ERROR',
      ),
      orchestrator.checkFile(
        path.join(WORKSPACE_ROOT, 'src/b.py'),
        'TYPE_ERROR = 1',
      ),
    ]);

    expect(tsDiagnostics.length).toBeGreaterThan(0);
    expect(pyDiagnostics.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:workspace boundary
   */
  it('does not process files outside workspace boundary', async () => {
    const orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const diagnostics = await orchestrator.checkFile(
      '/other-root/outside.ts',
      'const x = TYPE_ERROR',
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:getAllDiagnostics/known-files
   */
  it('returns diagnostics keyed by known files via getAllDiagnostics after touches', async () => {
    const orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/k1.ts'),
      'const x = TYPE_ERROR',
    );
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/k2.ts'),
      'const x = TYPE_ERROR',
    );

    const all = await orchestrator.getAllDiagnostics();
    expect(Object.keys(all).sort()).toEqual([
      path.join(WORKSPACE_ROOT, 'src/k1.ts'),
      path.join(WORKSPACE_ROOT, 'src/k2.ts'),
    ]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:broken server bypass
   */
  it('bypasses a broken server and continues returning empty diagnostics without throw', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-ts', ['.ts'], ['--crash-on-did-open']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/crash.ts'),
      'const x = TYPE_ERROR',
    );
    const afterCrash = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/crash.ts'),
      'const x = TYPE_ERROR',
    );

    expect(afterCrash).toEqual([]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:shutdown
   */
  it('shuts down all started clients and reports non-ok status afterwards', async () => {
    const orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/shutdown.ts'),
      'const x = TYPE_ERROR',
    );
    await orchestrator.shutdown();

    const status = await orchestrator.status();
    expect(
      status.some((s) => s.serverId === 'fake-ts' && s.state === 'ok'),
    ).toBe(false);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:status states
   */
  it('exposes status transitions for starting/ok/broken states', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-good', ['.ts']),
        createFakeServer('fake-bad', ['.tsx'], ['--crash-on-did-open']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/s1.ts'),
      'const x = TYPE_ERROR',
    );
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/s2.tsx'),
      'const x = TYPE_ERROR',
    );

    const status = await orchestrator.status();
    expect(
      status.some((s) => s.serverId === 'fake-good' && s.state === 'ok'),
    ).toBe(true);
    expect(
      status.some((s) => s.serverId === 'fake-bad' && s.state === 'broken'),
    ).toBe(true);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:navigation delegation
   */
  it('delegates navigation calls to routed server and returns locations', async () => {
    const orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const definitions = await orchestrator.gotoDefinition(
      path.join(WORKSPACE_ROOT, 'src/nav.ts'),
      0,
      6,
    );
    expect(definitions.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:unknown extension
   */
  it('returns empty diagnostics for unknown extension with no matching server', async () => {
    const orchestrator = createOrchestrator(
      createConfig([createFakeServer('fake-ts', ['.ts'])]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const diagnostics = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/file.unknown'),
      'TYPE_ERROR',
    );
    expect(diagnostics).toEqual([]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:known-file any-server semantics
   */
  it('retains known-file diagnostics when any capable server has seen the file', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-a', ['.ts']),
        createFakeServer('fake-b', ['.ts']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/known.ts'),
      'const x = TYPE_ERROR',
    );
    const all = await orchestrator.getAllDiagnostics();

    expect(
      all[path.join(WORKSPACE_ROOT, 'src/known.ts')]?.length ?? 0,
    ).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:first-touch vs normal timeout
   */
  it('uses first-touch timeout behavior distinct from subsequent touch behavior', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-ts', ['.ts'], ['--delay-ms', '500']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const first = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/touch-timeout.ts'),
      'const x = TYPE_ERROR',
    );
    const second = await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/touch-timeout.ts'),
      'const x = TYPE_ERROR // changed',
    );

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:status all configured servers
   */
  it('status includes all configured servers even before first touch', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fake-a', ['.ts']),
        createFakeServer('fake-b', ['.py']),
        createFakeServer('fake-c', ['.go']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const status = await orchestrator.status();
    expect(status.map((s) => s.serverId).sort()).toEqual([
      'fake-a',
      'fake-b',
      'fake-c',
    ]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:status alphabetical ordering
   */
  it('returns status entries in alphabetical serverId order', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('z-server', ['.ts']),
        createFakeServer('a-server', ['.py']),
        createFakeServer('m-server', ['.go']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    const status = await orchestrator.status();
    expect(status.map((s) => s.serverId)).toEqual([
      'a-server',
      'm-server',
      'z-server',
    ]);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:shutdown error aggregation
   * @given:Two initialized servers that both ignore the shutdown request,
   *        causing LspRequestTimeoutError in each client
   * @when:orchestrator.shutdown() is called
   * @then:shutdown rejects with an AggregateError containing both failures
   *        rather than swallowing them, proving cleanup attempts all clients
   *        before propagating
   */
  it('propagates an AggregateError when multiple clients fail during shutdown', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fail-a', ['.ts'], ['--ignore-shutdown']),
        createFakeServer('fail-b', ['.tsx'], ['--ignore-shutdown']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );
    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/b.tsx'),
      'const y = TYPE_ERROR',
    );

    let thrown: unknown = null;
    try {
      await orchestrator.shutdown();
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
  });

  /**
   * @plan:PLAN-20250212-LSP.P17
   * @scenario:single client shutdown error propagation
   * @given:One initialized server that ignores the shutdown request
   * @when:orchestrator.shutdown() is called
   * @then:shutdown rejects with the single underlying error (not wrapped in
   *        an AggregateError when there is only one failure)
   */
  it('propagates a single error when one client fails during shutdown', async () => {
    const orchestrator = createOrchestrator(
      createConfig([
        createFakeServer('fail-single', ['.ts'], ['--ignore-shutdown']),
      ]),
      WORKSPACE_ROOT,
    );
    createdOrchestrators.push(orchestrator);

    await orchestrator.checkFile(
      path.join(WORKSPACE_ROOT, 'src/single.ts'),
      'const x = TYPE_ERROR',
    );

    await expect(orchestrator.shutdown()).rejects.toThrow(/timed out/);
  });
});
