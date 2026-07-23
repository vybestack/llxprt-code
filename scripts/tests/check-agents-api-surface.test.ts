/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-agents-api-surface.mjs.
 *
 * Two test areas are covered:
 *
 *  1. Pure helper contract — resolveBuildTimeoutMs honors the env override
 *     and falls back to the default for absent / malformed / non-positive
 *     values (fail-closed). describeTscSpawnError classifies each error
 *     category correctly and reflects the actually-configured timeout in the
 *     timeout message. These exercise the ACTUAL exported helpers — no mocks,
 *     no spawned tsc.
 *
 *  2. End-to-end process run — the script runs the repository TypeScript
 *     compiler without npm or npx on PATH (using createRequire/process.execPath
 *     to resolve the local tsc), proving the guard has no implicit CLI tool
 *     dependency.
 *
 * The script's main() snapshot guard is also covered by the package pretest
 * (npm run lint:agents-api-surface) and agents publicSurface.guard.test.ts.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolveBuildTimeoutMs,
  describeTscSpawnError,
  DEFAULT_BUILD_TIMEOUT_MS,
} from '../check-agents-api-surface.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const checkerPath = join(repoRoot, 'scripts', 'check-agents-api-surface.mjs');

describe('resolveBuildTimeoutMs', () => {
  it('returns the default when the env var is absent', () => {
    expect(resolveBuildTimeoutMs({})).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('returns the default when the env var is an empty string', () => {
    expect(
      resolveBuildTimeoutMs({ LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: '' }),
    ).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('returns the override when a valid positive integer string is given', () => {
    expect(
      resolveBuildTimeoutMs({ LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: '600000' }),
    ).toBe(600000);
  });

  it('returns the override for a large value', () => {
    expect(
      resolveBuildTimeoutMs({
        LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: '900000',
      }),
    ).toBe(900000);
  });

  it('falls back to default for a non-numeric string (fail-closed)', () => {
    expect(
      resolveBuildTimeoutMs({ LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: 'abc' }),
    ).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('falls back to default for a negative number (fail-closed)', () => {
    expect(
      resolveBuildTimeoutMs({ LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: '-5' }),
    ).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('falls back to default for zero (fail-closed)', () => {
    expect(
      resolveBuildTimeoutMs({ LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: '0' }),
    ).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('falls back to default for NaN', () => {
    expect(
      resolveBuildTimeoutMs({ LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: 'NaN' }),
    ).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('falls back to default for Infinity', () => {
    expect(
      resolveBuildTimeoutMs({
        LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: 'Infinity',
      }),
    ).toBe(DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('floors a fractional value to an integer', () => {
    expect(
      resolveBuildTimeoutMs({
        LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS: '300000.9',
      }),
    ).toBe(300000);
  });

  it('defaults to 300000ms (5 min), well above the previous 120000ms', () => {
    expect(DEFAULT_BUILD_TIMEOUT_MS).toBe(300000);
    expect(DEFAULT_BUILD_TIMEOUT_MS).toBeGreaterThan(120000);
  });

  it('uses process.env when no argument is passed', () => {
    const saved = process.env.LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS;
    try {
      delete process.env.LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS;
      expect(resolveBuildTimeoutMs()).toBe(DEFAULT_BUILD_TIMEOUT_MS);
      process.env.LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS = '420000';
      expect(resolveBuildTimeoutMs()).toBe(420000);
    } finally {
      if (saved === undefined) {
        delete process.env.LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS;
      } else {
        process.env.LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS = saved;
      }
    }
  });
});

describe('describeTscSpawnError', () => {
  it('classifies a SIGTERM-without-status (timeout) and includes the configured timeout', () => {
    const msg = describeTscSpawnError(
      { signal: 'SIGTERM', status: null as unknown as undefined },
      180000,
    );
    expect(msg).toContain('timed out');
    expect(msg).toContain('180000ms');
  });

  it('uses the default timeout in the timeout message when none is passed', () => {
    const msg = describeTscSpawnError({
      signal: 'SIGTERM',
      status: null as unknown as undefined,
    });
    expect(msg).toContain(`${DEFAULT_BUILD_TIMEOUT_MS}ms`);
  });

  it('classifies an ERR_CHILD_PROCESS_STDIO_MAXBUFFER error', () => {
    const msg = describeTscSpawnError({
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    });
    expect(msg).toContain('maxBuffer');
    expect(msg).toContain('runaway output');
  });

  it('classifies an ENOENT spawn error', () => {
    const msg = describeTscSpawnError({ code: 'ENOENT' });
    expect(msg).toContain('ENOENT');
    expect(msg).toContain('Node');
  });

  it('classifies an arbitrary signal termination', () => {
    const msg = describeTscSpawnError({
      signal: 'SIGKILL',
      status: null as unknown as undefined,
    });
    expect(msg).toContain('SIGKILL');
    expect(msg).toContain('terminated by signal');
  });

  it('classifies a generic system error with code/status-null', () => {
    const err = {
      code: 'EACCES',
      errno: -13,
      syscall: 'spawn',
      path: '/usr/bin/npx',
      message: 'permission denied',
      status: null as unknown as undefined,
    };
    const msg = describeTscSpawnError(err);
    expect(msg).toContain('EACCES');
    expect(msg).toContain('errno');
    expect(msg).toContain('spawn');
    expect(msg).toContain('permission denied');
  });

  it('returns null for an ordinary non-zero exit (no special classification)', () => {
    const msg = describeTscSpawnError({ status: 1, signal: null });
    expect(msg).toBeNull();
  });

  it('returns null for a successful exit (status 0)', () => {
    const msg = describeTscSpawnError({ status: 0, signal: null });
    expect(msg).toBeNull();
  });
});

describe('agents API-surface checker process', () => {
  it('runs the repository TypeScript compiler without npm or npx on PATH', () => {
    const emptyPath = mkdtempSync(join(tmpdir(), 'agents-api-empty-path-'));

    try {
      const result = spawnSync(process.execPath, [checkerPath], {
        cwd: repoRoot,
        env: { ...process.env, PATH: emptyPath, Path: emptyPath },
        encoding: 'utf8',
        // The configurable default timeout is 5 min (300000ms); allow headroom
        // above it for slow CI runners / cold tsc builds.
        timeout: 360_000,
      });
      const diagnostics = [
        `status: ${String(result.status)}`,
        `error: ${result.error?.message ?? '<none>'}`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`,
      ].join('\n');

      expect(result.status, diagnostics).toBe(0);
      expect(result.stdout, diagnostics).toContain(
        'PASS: agents API-surface report matches expected snapshot.',
      );
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  }, 370_000);
});
