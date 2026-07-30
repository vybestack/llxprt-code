import { afterEach, describe, expect, it } from 'bun:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

import {
  createLspClient,
  LspRequestTimeoutError,
} from '../src/service/lsp-client';
import type { LspServerConfig } from '../src/types';
import { runCleanupTaskGroups } from './cleanup';

const WORKSPACE_ROOT = path.resolve('/workspace');
const WORKSPACE_URI = pathToFileURL(WORKSPACE_ROOT).toString();
const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/fake-lsp-server.ts', import.meta.url),
);

const createdClients: Array<ReturnType<typeof createLspClient>> = [];
const temporaryDirectories: string[] = [];

function createPidFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-pid-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'pid.txt');
}

function readPid(pidFilePath: string): number {
  const pid = Number.parseInt(fs.readFileSync(pidFilePath, 'utf8').trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid PID in ${pidFilePath}`);
  }
  return pid;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createConfig(args: string[] = []): { config: LspServerConfig } {
  return {
    config: {
      id: 'fake-ts',
      command: process.execPath,
      args: [FIXTURE_PATH, ...args],
      rootUri: WORKSPACE_URI,
    },
  };
}

afterEach(async () => {
  const clients = createdClients.splice(0);
  const directories = temporaryDirectories.splice(0);
  await runCleanupTaskGroups(
    [
      clients.map((client) => () => client.shutdown()),
      directories.map(
        (directory) => () =>
          fs.rmSync(directory, { recursive: true, force: true }),
      ),
    ],
    'LSP client integration cleanup failed',
  );
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
    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
      'const x = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      path.join(WORKSPACE_ROOT, 'src/a.ts'),
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
    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/b.ts'),
      'const x = TYPE_ERROR',
    );
    await client.waitForDiagnostics(path.join(WORKSPACE_ROOT, 'src/b.ts'), 800);

    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/b.ts'),
      'const x = TYPE_ERROR\n// WARN',
    );
    const diagnostics = await client.waitForDiagnostics(
      path.join(WORKSPACE_ROOT, 'src/b.ts'),
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
    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/c.ts'),
      'const x = TYPE_ERROR',
    );
    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/c.ts'),
      'const x = TYPE_ERROR\n// WARN',
    );
    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/c.ts'),
      'const x = TYPE_ERROR\n// WARN\nconst y = TYPE_ERROR',
    );

    const diagnostics = await client.waitForDiagnostics(
      path.join(WORKSPACE_ROOT, 'src/c.ts'),
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
    await client.touchFile(
      path.join(WORKSPACE_ROOT, 'src/crash.ts'),
      'const x = TYPE_ERROR',
    );

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
    await client.shutdown();
    expect(client.isAlive()).toBe(false);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Force-terminate child process when server ignores exit notification
   * @given:A server that acknowledges `shutdown` but ignores the `exit`
   *        notification (does not self-terminate)
   * @when:shutdown is invoked
   * @then:shutdown resolves, the client reports not alive, the child process
   *        is externally gone (PID no longer alive), and the call completes
   *        well under the 5-second caller budget
   */
  it('terminates child process even when server ignores exit notification', async () => {
    const pidFile = createPidFile();
    const client = createLspClient(
      createConfig(['--ignore-exit-notification', '--write-pid', pidFile]),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();

    const pid = readPid(pidFile);
    expect(isPidAlive(pid)).toBe(true);

    const start = Date.now();
    await client.shutdown();
    const elapsed = Date.now() - start;

    expect(client.isAlive()).toBe(false);
    expect(isPidAlive(pid)).toBe(false);
    expect(elapsed).toBeLessThan(5_000);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Force-terminate child process when server never answers shutdown
   * @given:A server that ignores the `shutdown` request entirely (never
   *        responds), causing the protocol timeout to fire
   * @when:shutdown is invoked
   * @then:shutdown rejects after cleanup, the client reports not alive, the
   *        child process is externally gone (PID no longer alive), and the call
   *        completes under the 5-second caller budget with the primary
   *        LspRequestTimeoutError.
   */
  it('force-terminates and surfaces timeout when server ignores shutdown request', async () => {
    const pidFile = createPidFile();
    const client = createLspClient(
      createConfig(['--ignore-shutdown', '--write-pid', pidFile]),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();

    const pid = readPid(pidFile);
    expect(isPidAlive(pid)).toBe(true);

    const start = Date.now();
    await expect(client.shutdown()).rejects.toThrow(LspRequestTimeoutError);
    const elapsed = Date.now() - start;

    expect(client.isAlive()).toBe(false);
    expect(isPidAlive(pid)).toBe(false);
    expect(elapsed).toBeLessThan(5_000);
  });

  /**
   * @plan:PLAN-20250212-LSP.P10
   * @requirement:REQ-LIFE-010
   * @scenario:Exit-notification pipe race after acknowledged shutdown resolves
   * @given:A server that acknowledges `shutdown` and immediately exits, closing
   *        the pipe before the client's `exit` notification write completes
   * @when:shutdown is invoked
   * @then:shutdown resolves (the pipe race is a natural consequence of
   *        successful termination, not a shutdown failure), the client reports
   *        not alive, and the child process is externally gone
   */
  it('resolves when server exits promptly after acknowledged shutdown', async () => {
    const pidFile = createPidFile();
    const client = createLspClient(
      createConfig(['--exit-on-shutdown', '--write-pid', pidFile]),
      WORKSPACE_ROOT,
    );
    createdClients.push(client);

    await client.initialize();

    const pid = readPid(pidFile);
    expect(isPidAlive(pid)).toBe(true);

    await client.shutdown();
    expect(client.isAlive()).toBe(false);
    expect(isPidAlive(pid)).toBe(false);
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
      path.join(WORKSPACE_ROOT, 'src/never-opened.ts'),
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
      client.touchFile(
        path.join(WORKSPACE_ROOT, 'src/f1.ts'),
        'const x = TYPE_ERROR',
      ),
      client.touchFile(
        path.join(WORKSPACE_ROOT, 'src/f2.ts'),
        'const x = TYPE_ERROR\n// WARN',
      ),
    ]);

    const [d1, d2] = await Promise.all([
      client.waitForDiagnostics(path.join(WORKSPACE_ROOT, 'src/f1.ts'), 800),
      client.waitForDiagnostics(path.join(WORKSPACE_ROOT, 'src/f2.ts'), 800),
    ]);

    expect(d1.length).toBeGreaterThan(0);
    expect(d2.length).toBeGreaterThan(0);
  });
});
