/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const cliPackageRoot = resolve(__dirname, '..', '..');
const credentialSocketEnv = 'LLXPRT_CREDENTIAL_SOCKET';
const loadCommonJsModule = createRequire(import.meta.url);

// The single source of truth for the sidecar socket-directory prefix, loaded
// from the shared helper so these tests never hardcode a magic string that can
// drift from production.
const { PROXY_SOCKET_PREFIX } = loadCommonJsModule(
  resolve(cliPackageRoot, 'bin', 'launcher-credential-env.cjs'),
) as { PROXY_SOCKET_PREFIX: string };

interface SubprocessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

// Grace window to wait for a killed subprocess to emit 'close' before forcing
// the timeout rejection (in case SIGKILL never produces a close event).
const POST_KILL_GRACE_MS = 2_000;

function runSubprocess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 15_000,
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

describe('cli bin end-to-end credential routing', () => {
  it.each([
    // The launcher must treat an empty-string socket env the same as a missing
    // one — both should route the child through a freshly started proxy.
    ['empty string', ''] as const,
    ['absent', undefined] as const,
  ])(
    'routes no-compile launcher children through proxy-backed credential factories (socket env: %s)',
    async (_label, socketEnvValue) => {
      const binPath = resolve(cliPackageRoot, 'bin', 'llxprt.cjs');
      // This e2e test drives the real CJS launcher, so it needs a concrete Bun
      // binary path. The bundled Bun is a direct dependency installed at the
      // monorepo root, so resolve it there. This is intentionally a fixed path
      // (rather than the production resolveBunPath walker) to keep the test
      // hermetic; if the monorepo layout changes, update this path.
      const bunPath = resolve(
        cliPackageRoot,
        '..',
        '..',
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'bun.cmd' : 'bun',
      );
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
            '// The proxy-backed storage keeps an open socket handle, so the event',
            '// loop never drains on its own; exit explicitly. Exit from inside the',
            '// write callback, which fires only after the payload has flushed to',
            '// the pipe, so the parent never sees a truncated write.',
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
        // proxy-routing path regardless of env leakage from other tests in the
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
        const routed = parsed as {
          socket: string | null;
          storageType: string;
        };
        // The sidecar creates its socket inside <tmpdir>/<prefix><id>/, so assert
        // on the directory portion rather than a bare substring match — that
        // mirrors the production contract in isSafeProxySocketDir (basename of the
        // socket directory starts with the shared prefix).
        const { socket } = routed;
        if (socket === null) {
          throw new Error('Expected child to report a non-null socket path');
        }
        // Assert on the socket's parent directory basename using string ops
        // (rather than a dynamically built regex) so the shared prefix needs no
        // regex escaping: it must start with the prefix and contain a generated
        // suffix.
        const socketParentDir = dirname(socket);
        const socketDirName = basename(socketParentDir);
        expect(socketDirName.startsWith(PROXY_SOCKET_PREFIX)).toBe(true);
        expect(socketDirName.length).toBeGreaterThan(
          PROXY_SOCKET_PREFIX.length,
        );
        expect(routed.storageType).toBe('ProxyProviderKeyStorage');

        // The launcher child has fully exited (runSubprocess awaited its close),
        // so the credential proxy sidecar must have terminated gracefully and
        // removed its own socket directory. Poll to allow for async cleanup (OS
        // file-handle release can lag, especially under CI load). A lingering
        // directory would signal a leaked sidecar process.
        await vi.waitFor(
          async () => {
            expect(await pathExists(socketParentDir)).toBe(false);
          },
          { timeout: 5_000, interval: 100 },
        );
      } finally {
        // Cleanup must never mask the real assertion failure with a transient
        // rm error (EBUSY/EPERM on Windows while subprocess handles release).
        // The `temp-*` gitignore rule guarantees an orphan never pollutes the
        // working tree even if this removal is skipped.
        await rm(tempDir, { force: true, recursive: true }).catch(() => {});
      }
    },
    20_000,
  );

  it('creates the sidecar socket directory using the shared prefix', async () => {
    // Behavioral drift guard: the shared helper is the single source of truth
    // for the socket-directory prefix, and the real sidecar must create its
    // directory with that exact prefix. This proves launcher and sidecar agree
    // at runtime without asserting on source text.
    expect(typeof PROXY_SOCKET_PREFIX).toBe('string');
    expect(PROXY_SOCKET_PREFIX.length).toBeGreaterThan(0);

    const bin = loadCommonJsModule(
      resolve(cliPackageRoot, 'bin', 'llxprt.cjs'),
    ) as {
      createCredentialProxyDefault: () => Promise<{
        socketPath: string;
        socketDir: string;
        stop: () => Promise<void>;
      }>;
    };

    // Use vi.stubEnv for automatic, lifecycle-integrated cleanup (matching the
    // codebase convention). An empty string is treated as missing by
    // hasUsableCredentialSocket(), so the launcher starts a fresh proxy.
    vi.stubEnv(credentialSocketEnv, '');
    let proxy:
      | Awaited<ReturnType<typeof bin.createCredentialProxyDefault>>
      | undefined;
    try {
      proxy = await bin.createCredentialProxyDefault();
      expect(basename(proxy.socketDir).startsWith(PROXY_SOCKET_PREFIX)).toBe(
        true,
      );
      expect(dirname(proxy.socketPath)).toBe(proxy.socketDir);
    } finally {
      await proxy?.stop().catch((error) => {
        process.stderr.write(
          `warning: credential proxy stop failed: ${String(error)}
`,
        );
      });
      vi.unstubAllEnvs();
    }
  }, 20_000);
});
