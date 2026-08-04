/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-container driver for the process-memory-hardening behavioral tests
 * (issue #3028, AC1/AC4/AC5). This runs INSIDE the sandbox container under Bun.
 *
 * It operates in three modes, selected by argv:
 *
 * 1. Default (parent/tracer) — spawns a CHILD process and reads the CHILD's
 *    `/proc/<pid>/{maps,mem}` from the parent. The relationship is deliberately
 *    parent-reads-child (the more permissive direction) so the test is
 *    Yama-independent: under `ptrace_scope` 0 AND 1 a parent may trace a
 *    descendant, so denying that read implies denying the realistic
 *    descendant-reads-ancestor direction.
 *
 * 2. `__child__` (target) — imports the REAL production module
 *    (`packages/cli/src/launcher/process-memory-hardening.ts`), calls the REAL
 *    `applyProcessMemoryHardening()`, holds a 64-hex secret resident in its
 *    heap, signals readiness, and stays alive until killed.
 *
 * 3. `__e2e__` — spawns a child in `__child__` mode (which imports the REAL
 *    production module from the same path as `packages/cli/index.ts` and calls
 *    the REAL `applyProcessMemoryHardening()` with `SANDBOX` set), then stats
 *    `/proc/<child>/maps` and asserts it is root-owned (which is exactly what
 *    non-dumpable produces for a non-root process). This proves the real
 *    production hardening function makes the process non-dumpable.
 *
 *    NOTE: a full `bun packages/cli/index.ts` launch is not achievable inside
 *    the current sandbox container image because `index.ts` statically imports
 *    `@vybestack/llxprt-code-core` (the barrel), which transitively loads
 *    `@vybestack/llxprt-code-tools` → `sharp`, and `sharp` is not installed in
 *    the image. The `__e2e__` mode exercises the same real production function
 *    that index.ts calls; the lexical ordering test in the unit suite proves
 *    index.ts actually calls it.
 *
 * The parent prints one of:
 *   RESULT=MAPS_DENIED        — /proc/<child>/maps open denied (EACCES):
 *                               the hardening held.
 *   RESULT=TOKEN_RECOVERED    — maps+mem readable and the secret was found.
 *   RESULT=MAPS_OK_MEM_DENIED — maps readable but mem denied.
 *   RESULT=MAPS_OK_NOT_FOUND  — maps+mem readable but secret not located.
 *
 * The E2E mode prints one of:
 *   RESULT=E2E_HARDENED       — /proc/<child>/maps is root-owned (non-dumpable).
 *   RESULT=E2E_NOT_HARDENED   — maps is owned by the process user (dumpable).
 *   RESULT=E2E_EXITED         — the CLI exited before ownership could be read.
 *   RESULT=E2E_TIMEOUT        — timed out polling.
 *
 * The repository is mounted at `/repo` by the test (read-only), so relative
 * imports resolve the real module regardless of the mount path.
 */

import { applyProcessMemoryHardening } from '../../packages/cli/src/launcher/process-memory-hardening.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs';

const CHILD_ARG = '__child__';
const E2E_ARG = '__e2e__';

// 64-hex token-shaped secret. Doubled and pinned on a global so it cannot be
// optimized away before the parent scans.
const SECRET = 'deadbeef'.repeat(8);

const PROBE_POLL_BUDGET_MS = 15_000;
const MAX_REGION_BYTES = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Mode dispatch
// ---------------------------------------------------------------------------

await main();

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === CHILD_ARG) {
    await runChild();
  } else if (mode === E2E_ARG) {
    await runE2e();
  } else {
    await runParent();
  }
}

// ---------------------------------------------------------------------------
// Child (target) mode
// ---------------------------------------------------------------------------

async function runChild(): Promise<void> {
  // Pin the secret in this process's heap before hardening.
  const pinned = SECRET + SECRET;
  (globalThis as Record<string, unknown>).__LLXPRT_PROBE_SECRET = pinned;

  // Force JavaScriptCore to materialize the rope string. Without this, Bun
  // (especially 1.3.x / JavaScriptCore) may keep the concatenation as a
  // deferred rope, and the byte pattern will not be present in the heap for
  // the parent to find. Iterating charCodeAt flattens the rope.
  let checksum = 0;
  for (let i = 0; i < pinned.length; i++) {
    checksum += pinned.charCodeAt(i);
  }
  (globalThis as Record<string, unknown>).__LLXPRT_CHECKSUM = checksum;

  // Harden THIS process via the real production function. The gate engages
  // when SANDBOX is set (controlled by the test's container env).
  await applyProcessMemoryHardening();

  // Signal readiness to the parent, then stay alive so /proc/<pid>/mem remains
  // readable.
  process.stdout.write(`READY ${process.pid}\n`);
  process.stdin.resume();
}

// ---------------------------------------------------------------------------
// Parent (tracer) mode
// ---------------------------------------------------------------------------

async function runParent(): Promise<void> {
  const scriptPath = process.argv[1]!;
  const child = spawn('bun', [scriptPath, CHILD_ARG], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  let result = 'ERROR:unreachable';
  try {
    const childPid = await waitForReady(child);
    result = scanProcessMemory(childPid, SECRET);
  } catch (err) {
    result = `ERROR:${err instanceof Error ? err.message : String(err)}`;
  } finally {
    killChild(child);
  }

  process.stdout.write(`RESULT=${result}\n`);
  process.exit(0);
}

function waitForReady(child: ChildProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for child READY'));
    }, PROBE_POLL_BUDGET_MS);

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        clearTimeout(timer);
        const match = line.match(/^READY\s+(\d+)$/);
        if (match !== null) {
          resolve(Number.parseInt(match[1], 10));
        } else {
          reject(new Error(`unexpected child output: ${line}`));
        }
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited (code=${code}) before READY`));
    });
  });
}

/**
 * Reads /proc/<pid>/maps and, if readable, scans each writable memory region
 * of /proc/<pid>/mem for the secret. Returns a RESULT= token.
 */
function scanProcessMemory(pid: number, secret: string): string {
  let maps: string;
  try {
    maps = readFileSync(`/proc/${pid}/maps`, 'latin1');
  } catch (err) {
    if (isEacces(err)) return 'MAPS_DENIED';
    return `MAPS_OPEN_FAILED:${errnoOf(err)}`;
  }

  let memFd: number;
  try {
    memFd = openSync(`/proc/${pid}/mem`, 'r');
  } catch (err) {
    if (isEacces(err)) return 'MAPS_OK_MEM_DENIED';
    return `MEM_OPEN_FAILED:${errnoOf(err)}`;
  }

  try {
    const secretBuf = Buffer.from(secret, 'latin1');
    for (const line of maps.split('\n')) {
      const parts = line.split(/\s+/);
      if (parts.length < 2 || !parts[0].includes('-')) continue;
      if (!parts[1].includes('w')) continue;
      const range = parts[0].split('-');
      const start = Number.parseInt(range[0], 16);
      const end = Number.parseInt(range[1], 16);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const size = end - start;
      if (size <= 0 || size > MAX_REGION_BYTES) continue;
      const buf = Buffer.alloc(size);
      const bytesRead = readSync(memFd, buf, 0, size, start);
      if (buf.subarray(0, bytesRead).includes(secretBuf)) {
        return 'TOKEN_RECOVERED';
      }
    }
    return 'MAPS_OK_NOT_FOUND';
  } finally {
    closeSync(memFd);
  }
}

// ---------------------------------------------------------------------------
// E2E mode — exercises the real production function and asserts ownership
// ---------------------------------------------------------------------------

async function runE2e(): Promise<void> {
  // Spawn a child in __child__ mode, which imports the REAL production module
  // from the same path as packages/cli/index.ts and calls the REAL
  // applyProcessMemoryHardening(). A full index.ts launch is not possible in
  // this container image (the core barrel transitively requires sharp, which
  // is not installed); this exercises the identical function that index.ts
  // calls.
  const scriptPath = process.argv[1]!;
  const child = spawn('bun', [scriptPath, CHILD_ARG], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      SANDBOX: process.env['SANDBOX'] ?? 'e2e-probe',
    },
  });

  let result = 'E2E_TIMEOUT';
  try {
    const childPid = await waitForReady(child);
    result = checkMapsOwnership(childPid);
  } catch (err) {
    result = `E2E_ERROR:${err instanceof Error ? err.message : String(err)}`;
  } finally {
    killChild(child);
  }

  process.stdout.write(`RESULT=${result}\n`);
  process.exit(0);
}

/**
 * Stats /proc/<pid>/maps. When the process is non-dumpable the proc files are
 * owned by root (uid 0, gid 0); when dumpable they are owned by the process's
 * own uid.
 */
function checkMapsOwnership(pid: number): string {
  try {
    const st = statSync(`/proc/${pid}/maps`);
    if (st.uid === 0 && st.gid === 0) {
      return 'E2E_HARDENED';
    }
    return 'E2E_NOT_HARDENED';
  } catch {
    return 'E2E_STAT_FAILED';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function killChild(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch {
    // best-effort
  }
}

function isEacces(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'EACCES'
  );
}

function errnoOf(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).errno !== undefined
  ) {
    return String((err as NodeJS.ErrnoException).errno);
  }
  return 'unknown';
}
