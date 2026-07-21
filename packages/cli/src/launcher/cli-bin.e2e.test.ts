/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  access,
} from 'node:fs/promises';
import { accessSync, constants, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { z } from 'zod';

const childReportSchema = z.object({
  execPath: z.string(),
  argv: z.array(z.string()),
});
type ChildReport = z.infer<typeof childReportSchema>;

const SUBPROCESS_TIMEOUT_MS = 15_000;
const UNSAFE_CMD_ARGUMENT_EXIT_CODE = 43;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutableFromPath(command: string): string | null {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], {
    encoding: 'utf8',
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    return null;
  }
  return (
    result.stdout.split(/\r?\n/).find((line) => line.trim() !== '') ?? null
  );
}

async function resolveTestBunPath(workspaceBunPath: string): Promise<string> {
  const envBunPath = process.env['BUN_PATH'];
  if (envBunPath !== undefined) {
    return envBunPath;
  }
  if (await pathExists(workspaceBunPath)) {
    return workspaceBunPath;
  }
  return resolveExecutableFromPath('bun') ?? workspaceBunPath;
}

const cliPackageRoot = resolve(__dirname, '..', '..');
const repositoryRoot = resolve(cliPackageRoot, '..', '..');
const localBunCmd = resolve(repositoryRoot, 'node_modules', '.bin', 'bun.cmd');
const localBunExe = resolve(repositoryRoot, 'node_modules', '.bin', 'bun.exe');
const directBunExe = resolve(
  repositoryRoot,
  'node_modules',
  'bun',
  'bin',
  'bun.exe',
);
const credentialSocketEnv = 'LLXPRT_CREDENTIAL_SOCKET';

interface SubprocessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface DefaultResolverResult extends SubprocessResult {
  readonly selectedExecutable: string | null;
}

// Grace window to wait for a killed subprocess to emit 'close' before forcing
// the timeout rejection (in case SIGKILL never produces a close event).
const POST_KILL_GRACE_MS = 2_000;

function runSubprocess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = SUBPROCESS_TIMEOUT_MS,
): Promise<SubprocessResult> {
  return new Promise((resolveSubprocess, reject) => {
    // Spawn in its own process group (detached) so the timeout handler can kill
    // the whole tree — the Node wrapper AND the Bun grandchild it spawns —
    // since SIGKILL is not propagated to descendants by default.
    const child = spawn(command, [...args], {
      cwd: cliPackageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // A stdio stream with no 'error' listener throws an uncaught exception when
    // it errors (e.g. EPIPE/ECONNRESET during a kill), which would crash the
    // whole test process. Swallow stream errors here and rely on the child's
    // 'error'/'close' events for the promise's resolution.
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    const killTree = () => {
      if (typeof child.pid === 'number') {
        if (process.platform === 'win32') {
          // SIGKILL only reaps the Node wrapper, not the Bun grandchild, so use
          // taskkill /T to terminate the whole process tree on Windows.
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
            });
            return;
          } catch {
            // Fall through to killing just the direct child.
          }
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
            return;
          } catch {
            // Fall through to killing just the direct child.
          }
        }
      }
      child.kill('SIGKILL');
    };
    // Guard against a hung child (e.g. one that never exits): kill the whole
    // process tree, then reject after a fixed grace window. The grace timer is
    // the single rejection source — relying on a newly-attached 'close'
    // listener would be fragile because the pre-registered close handler
    // consumes the event first, and this also covers the case where SIGKILL
    // never produces a close event (defunct/zombie child).
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      killTree();
      setTimeout(() => {
        reject(
          new Error(
            [
              `Subprocess timed out after ${timeoutMs}ms`,
              `stdout: ${stdout}`,
              `stderr: ${stderr}`,
            ].join(String.fromCharCode(10)),
          ),
        );
      }, POST_KILL_GRACE_MS).unref();
    }, timeoutMs);
    timer.unref();
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveSubprocess({ code, signal, stdout, stderr });
    });
  });
}

/**
 * Shared harness for the e2e credential-routing tests: it spins up a real
 * Node→Bun launcher child (no mocks on the credential factory) and returns the
 * routing outcome the child observed.
 *
 * @param socketEnvValue - The value to set on the credential-socket env var
 *   before spawning the child. `undefined` removes the var entirely; an empty
 *   string leaves it set but falsy; any other string is passed through verbatim.
 * @returns The parsed `{ socket, storageType }` the child wrote to stdout.
 */
async function runLauncherChild(
  socketEnvValue: string | undefined,
): Promise<{ socket: string | null; storageType: string }> {
  const binPath = resolve(cliPackageRoot, 'bin', 'llxprt.cjs');
  // This e2e test drives the real CJS launcher, so it needs a concrete Bun
  // binary path. Prefer the bundled monorepo Bun when present, but allow
  // developer installs that expose Bun on PATH without creating a local
  // node_modules/.bin/bun shim.
  const workspaceBunPath = resolve(
    cliPackageRoot,
    '..',
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'bun.cmd' : 'bun',
  );
  const bunPath = await resolveTestBunPath(workspaceBunPath);
  // Fail fast with an actionable message if the monorepo layout has
  // shifted, rather than surfacing an opaque ENOENT from inside the spawned
  // subprocess. Do this BEFORE creating the temp dir so a stale path can
  // never leave an orphaned directory behind.
  try {
    accessSync(bunPath, constants.X_OK);
  } catch (error) {
    throw new Error(
      `Bun binary not found at ${bunPath}. The monorepo layout may have ` +
        `changed; update the bunPath resolution in this test.`,
      { cause: error },
    );
  }

  // Create the temp dir inside the cli package so Bun's node_modules
  // resolution walks up into the monorepo workspace to find provider
  // packages; a dir under the OS tmpdir cannot reach them. The `temp-`
  // prefix is covered by the root .gitignore `temp-*` rule, so an orphaned
  // directory (e.g. if the process is SIGKILLed before the finally block
  // runs) never pollutes the working tree.
  const tempDir = await mkdtemp(join(cliPackageRoot, 'temp-e2e-launcher-'));
  const childEntry = join(tempDir, 'child.ts');
  const launcherWrapper = join(tempDir, 'launcher-wrapper.cjs');

  try {
    await writeFile(
      childEntry,
      [
        "import { createProviderKeyStorage } from '@vybestack/llxprt-code-providers/auth.js';",
        'const storage = createProviderKeyStorage();',
        '// In non-sandbox mode the stub starts no proxy, so the child reads',
        '// the keychain directly (ProviderKeyStorage). Only assert the store',
        '// type + socket — never call getKey, which could hit the real keychain',
        '// and prompt.',
        'process.stdout.write(',
        '  JSON.stringify({',
        '    socket: process.env.LLXPRT_CREDENTIAL_SOCKET ?? null,',
        '    storageType: storage.constructor.name,',
        '  }) + "\\n",',
        '  () => process.exit(0),',
        ');',
      ].join('\n'),
    );
    // The wrapper source is fully static: the launcher bin path, the Bun
    // binary path, and the child entry are passed in through the
    // environment and read at runtime with process.env, rather than
    // interpolated into the generated source. This keeps test-controlled
    // filesystem paths out of the code-construction sink entirely (no
    // JSON.stringify-into-source, which is not a safe JS escaper for values
    // like U+2028/U+2029).
    await writeFile(
      launcherWrapper,
      [
        `'use strict';`,
        `const binPath = process.env.LLXPRT_E2E_BIN_PATH;`,
        `const bunPath = process.env.LLXPRT_E2E_BUN_PATH;`,
        `const childEntry = process.env.LLXPRT_E2E_CHILD_ENTRY;`,
        `const { runCliBin } = require(binPath);`,
        `runCliBin({`,
        `  resolveBun: () => bunPath,`,
        `  resolveEntry: () => childEntry,`,
        `  exit: (code) => process.exit(code ?? 0),`,
        `}).catch((error) => {`,
        `  process.stderr.write(String(error instanceof Error ? error.stack : error));`,
        `  process.exit(1);`,
        `});`,
      ].join('\n'),
    );

    const childEnv = { ...process.env };
    // Hand the launcher wrapper its filesystem paths through the
    // environment so the generated source above stays static.
    childEnv['LLXPRT_E2E_BIN_PATH'] = binPath;
    childEnv['LLXPRT_E2E_BUN_PATH'] = bunPath;
    childEnv['LLXPRT_E2E_CHILD_ENTRY'] = childEntry;
    // Ensure a clean relaunch state so the launcher exercises its full
    // routing path regardless of env leakage from other tests in the
    // same worker.
    delete childEnv['LLXPRT_BUN_RELAUNCHED'];
    if (socketEnvValue === undefined) {
      delete childEnv[credentialSocketEnv];
    } else {
      childEnv[credentialSocketEnv] = socketEnvValue;
    }
    const result = await runSubprocess(
      process.execPath,
      [launcherWrapper, '--key', 'sk-test'],
      childEnv,
    );

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    // Parse stdout before the stderr assertion so a garbled/non-JSON
    // payload surfaces a clear diagnostic (including stderr) rather than
    // being masked by that assertion below.
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch (error) {
      throw new Error(
        `Failed to parse child stdout as JSON: ${String(error)}\n` +
          `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
        { cause: error },
      );
    }
    // The happy path must not surface a real uncaught exception / error
    // header from the runtime. Anchor to the start of a line and require the
    // specific runtime error formats (with trailing content) so benign
    // warnings (e.g. ExperimentalWarning), deprecation notices, or stack
    // frames that merely mention these words do not cause spurious failures.
    // Exit code is the primary success signal (asserted above); this is a
    // secondary guard against silent runtime errors.
    expect(result.stderr).not.toMatch(/^(Uncaught .+|Error: .+)/m);
    return parsed as { socket: string | null; storageType: string };
  } finally {
    await cleanupTempDirectory(tempDir);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CleanupOperations {
  readonly remove: (directory: string) => Promise<void>;
  readonly reportFailure: (message: string) => void;
}

const defaultCleanupOperations: CleanupOperations = {
  remove: async (directory) => rm(directory, { force: true, recursive: true }),
  reportFailure: (message) => process.stderr.write(message),
};

async function cleanupTempDirectory(
  directory: string,
  operations: CleanupOperations = defaultCleanupOperations,
): Promise<void> {
  try {
    await operations.remove(directory);
  } catch (error) {
    try {
      operations.reportFailure(
        `Failed to remove test directory ${directory} (${describeError(error)}).\n`,
      );
    } catch (reportingError) {
      void reportingError;
    }
  }
}

interface BunCmdFixture {
  readonly bunPath: string;
  readonly tempDir: string;
}

async function createBunCmdFixture(
  shimDirectoryName = 'bun shim',
): Promise<BunCmdFixture> {
  const tempDir = await mkdtemp(join(tmpdir(), 'llxprt e2e cmd '));
  const shimDirectory = join(tempDir, shimDirectoryName);
  const bunPath = join(shimDirectory, 'bun.cmd');
  await mkdir(shimDirectory, { recursive: true });
  await writeFile(bunPath, `@ECHO off\r\n@"${directBunExe}" %*\r\n`);
  return { bunPath, tempDir };
}

async function runDefaultResolverLauncher(
  args: readonly string[],
  bunPath?: string,
): Promise<DefaultResolverResult> {
  const binPath = resolve(cliPackageRoot, 'bin', 'llxprt.cjs');
  const tempDir = await mkdtemp(join(tmpdir(), 'llxprt-e2e-argv-'));
  const childEntry = join(tempDir, 'child.ts');
  const launcherWrapper = join(tempDir, 'launcher-wrapper.cjs');
  const selectedExecutableReport = join(tempDir, 'selected-executable.txt');

  try {
    await writeFile(
      childEntry,
      [
        'process.stdout.write(',
        '  JSON.stringify({ execPath: process.execPath, argv: process.argv.slice(2) }) + "\\n",',
        '  () => process.exit(0),',
        ');',
      ].join('\n'),
    );
    await writeFile(
      launcherWrapper,
      [
        `'use strict';`,
        `const { spawn } = require('node:child_process');`,
        `const { writeFileSync } = require('node:fs');`,
        `const { runCliBin } = require(process.env.LLXPRT_E2E_BIN_PATH);`,
        `const options = {`,
        `  resolveEntry: () => process.env.LLXPRT_E2E_CHILD_ENTRY,`,
        `  spawn: (command, args, spawnOptions) => {`,
        `    writeFileSync(process.env.LLXPRT_E2E_SELECTED_EXECUTABLE, command);`,
        `    return spawn(command, args, spawnOptions);`,
        `  },`,
        `  exit: (code) => process.exit(code ?? 0),`,
        `};`,
        `if (process.env.LLXPRT_E2E_BUN_PATH) {`,
        `  options.resolveBun = () => process.env.LLXPRT_E2E_BUN_PATH;`,
        `}`,
        `runCliBin(options).catch((error) => {`,
        `  process.stderr.write(String(error instanceof Error ? error.stack : error));`,
        `  process.exit(1);`,
        `});`,
      ].join('\n'),
    );

    const env = {
      ...process.env,
      LLXPRT_E2E_BIN_PATH: binPath,
      LLXPRT_E2E_CHILD_ENTRY: childEntry,
      LLXPRT_E2E_SELECTED_EXECUTABLE: selectedExecutableReport,
    };
    delete env['LLXPRT_BUN_RELAUNCHED'];
    if (bunPath !== undefined) {
      env['LLXPRT_E2E_BUN_PATH'] = bunPath;
    } else {
      delete env['LLXPRT_E2E_BUN_PATH'];
    }

    const result = await runSubprocess(
      process.execPath,
      [launcherWrapper, ...args],
      env,
    );
    const selectedExecutable = (await pathExists(selectedExecutableReport))
      ? await readFile(selectedExecutableReport, 'utf8')
      : null;
    return { ...result, selectedExecutable };
  } finally {
    await cleanupTempDirectory(tempDir);
  }
}

function parseChildReport(result: SubprocessResult): ChildReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(
      `Failed to parse child stdout as JSON: ${String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      { cause: error },
    );
  }
  try {
    return childReportSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Failed to validate child report: ${String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      { cause: error },
    );
  }
}

describe('cleanupTempDirectory', () => {
  it('reports removal failures without rejecting', async () => {
    const removalError = new Error('directory busy');
    const reported: string[] = [];

    await expect(
      cleanupTempDirectory('temporary-directory', {
        remove: async () => {
          throw removalError;
        },
        reportFailure: (message) => reported.push(message),
      }),
    ).resolves.toBeUndefined();
    expect(reported).toStrictEqual([
      'Failed to remove test directory temporary-directory (directory busy).\n',
    ]);
  });
});

describe('parseChildReport', () => {
  it('includes child output when stdout is not valid JSON', () => {
    const result: SubprocessResult = {
      code: 1,
      signal: null,
      stdout: 'not-json',
      stderr: 'child failed',
    };

    expect(() => parseChildReport(result)).toThrowError(
      /Failed to parse child stdout as JSON[\s\S]*stdout: not-json[\s\S]*stderr: child failed/,
    );
  });

  it('includes child output when valid JSON does not match the report schema', () => {
    const result: SubprocessResult = {
      code: 1,
      signal: null,
      stdout: '{"execPath":42,"argv":[]}',
      stderr: 'invalid child report',
    };

    expect(() => parseChildReport(result)).toThrowError(
      /Failed to validate child report[\s\S]*stdout: {"execPath":42,"argv":\[\]}[\s\S]*stderr: invalid child report/,
    );
  });
});

describe('cli bin Windows native Bun resolution', () => {
  it.runIf(process.platform === 'win32')(
    'selects the direct native executable when .bin contains only a command shim',
    async () => {
      expect(() => accessSync(localBunCmd, constants.X_OK)).not.toThrow();
      expect(existsSync(localBunExe)).toBe(false);
      expect(() => accessSync(directBunExe, constants.X_OK)).not.toThrow();

      const result = await runDefaultResolverLauncher([]);

      expect(result.code).toBe(0);
      const child = parseChildReport(result);
      expect(result.selectedExecutable?.toLowerCase()).toBe(
        directBunExe.toLowerCase(),
      );
      expect(child.execPath.toLowerCase()).toBe(directBunExe.toLowerCase());
      expect(result.stderr).not.toContain('DEP0190');
    },
  );

  it.runIf(process.platform === 'win32')(
    'preserves a multiword prompt as one child argument',
    async () => {
      const result = await runDefaultResolverLauncher([
        '--prompt',
        'hello world',
      ]);

      expect(result.code).toBe(0);
      const child = parseChildReport(result);
      expect(child.argv).toStrictEqual(['--prompt', 'hello world']);
    },
  );

  it.runIf(process.platform === 'win32')(
    'preserves a multiword prompt through a bun.cmd-only fallback',
    async () => {
      const result = await runDefaultResolverLauncher(
        ['--prompt', 'hello cmd world'],
        localBunCmd,
      );

      expect(result.code).toBe(0);
      const child = parseChildReport(result);
      expect(child.argv).toStrictEqual(['--prompt', 'hello cmd world']);
    },
  );

  it.runIf(process.platform === 'win32')(
    'preserves a trailing backslash before another argument through a bun.cmd path containing spaces',
    async () => {
      expect(() => accessSync(directBunExe, constants.X_OK)).not.toThrow();
      const fixture = await createBunCmdFixture();

      try {
        const trailingBackslash = 'C:\\allowed path\\';
        const result = await runDefaultResolverLauncher(
          ['--prompt', trailingBackslash, 'following argument'],
          fixture.bunPath,
        );

        expect(result.code).toBe(0);
        const child = parseChildReport(result);
        expect(child.argv).toStrictEqual([
          '--prompt',
          trailingBackslash,
          'following argument',
        ]);
        expect(result.stderr).not.toContain('DEP0190');
      } finally {
        await cleanupTempDirectory(fixture.tempDir);
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects a bun.cmd path containing command-shell metacharacters',
    async () => {
      expect(() => accessSync(directBunExe, constants.X_OK)).not.toThrow();
      const fixture = await createBunCmdFixture('bun & injected');

      try {
        const result = await runDefaultResolverLauncher([], fixture.bunPath);

        expect(result.code).toBe(UNSAFE_CMD_ARGUMENT_EXIT_CODE);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(
          'Cannot safely launch the bundled bun.cmd shim from a path containing Windows command-shell metacharacters',
        );
      } finally {
        await cleanupTempDirectory(fixture.tempDir);
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'preserves Windows shell metacharacters without a shell',
    async () => {
      const result = await runDefaultResolverLauncher([
        '--prompt',
        'hello & whoami',
      ]);

      expect(result.code).toBe(0);
      const child = parseChildReport(result);
      expect(child.argv).toStrictEqual(['--prompt', 'hello & whoami']);
      expect(result.stderr).not.toContain(
        'Cannot safely forward arguments containing Windows command-shell metacharacters',
      );
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects unsafe metacharacters for a bun.cmd-only fallback',
    async () => {
      const result = await runDefaultResolverLauncher(
        ['--prompt', 'hello & whoami'],
        localBunCmd,
      );

      expect(result.code).toBe(UNSAFE_CMD_ARGUMENT_EXIT_CODE);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(
        'Cannot safely forward arguments containing Windows command-shell metacharacters',
      );
      expect(result.stderr).toContain('bun.exe is on PATH');
    },
  );
});

describe('cli bin end-to-end credential routing', () => {
  it.each([
    // The launcher must treat an empty-string socket env the same as a missing
    // one — both should route the child to the DIRECT store (keychain-direct,
    // no proxy) per issue #2419.
    ['empty string', ''] as const,
    ['absent', undefined] as const,
  ])(
    'routes no-compile launcher children to the direct credential store (socket env: %s)',
    async (_label, socketEnvValue) => {
      const routed = await runLauncherChild(socketEnvValue);
      // The minimal stub starts NO proxy, so the child must see no usable
      // socket and select the DIRECT store (ProviderKeyStorage). An empty
      // string socket is treated as missing by the factory (falsy). This is
      // the core assertion of issue #2419: keychain-direct in non-sandbox.
      expect(routed.socket === null || routed.socket === '').toBe(true);
      expect(routed.storageType).toBe('ProviderKeyStorage');
      // It must NOT be the proxy-backed store.
      expect(routed.storageType).not.toBe('ProxyProviderKeyStorage');
    },
    20_000,
  );

  it('passes through a sandbox-provided credential socket so the child selects the proxy store', async () => {
    // A dummy socket path string. The factory only checks PRESENCE of the env
    // var to pick ProxyProviderKeyStorage; it constructs the client lazily and
    // never connects during construction, so a dummy value is safe.
    const dummySocket = join(tmpdir(), 'llxprt-dummy-sandbox.sock');
    const routed = await runLauncherChild(dummySocket);
    // The stub passes the parent's credential socket through unchanged (it
    // spreads process.env), so the child must select the proxy-backed store.
    expect(routed.socket).toBe(dummySocket);
    expect(routed.storageType).toBe('ProxyProviderKeyStorage');
  }, 20_000);
});
