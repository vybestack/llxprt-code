/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FatalError } from '@vybestack/llxprt-code-core/utils/errors.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyProcessMemoryHardening,
  type ProcessMemoryHardeningOptions,
} from './process-memory-hardening.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Signature of the injectable prctl callable. */
type PrctlCallable = NonNullable<ProcessMemoryHardeningOptions['prctl']>;

/** Builds a vi.fn spy matching the prctl callable signature. */
function prctlSpy(): ReturnType<typeof vi.fn<PrctlCallable>> {
  return vi.fn((() => 0) as PrctlCallable);
}

/** Builds a warning sink that captures every message it receives. */
function warningSink(): {
  sink: (message: string) => void;
  messages: string[];
} {
  const messages: string[] = [];
  return { sink: (m) => messages.push(m), messages };
}

/**
 * Clears the credential-bearing env markers so the gate tests do not
 * accidentally engage the credential-bearing arm when only the sandbox arm is
 * under test.
 */
function clearCredentialMarkers(): void {
  delete process.env.LLXPRT_CAPABILITY_FD;
  delete process.env.LLXPRT_CREDENTIAL_SOCKET;
}

describe('applyProcessMemoryHardening — gate (AC2)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...process.env };
    clearCredentialMarkers();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('invokes prctl(4, 0, 0, 0, 0) on Linux inside a container sandbox', async () => {
    process.env.SANDBOX = 'docker-llxprt-sandbox-0';
    const prctl = prctlSpy();
    await applyProcessMemoryHardening({
      prctl,
      platform: 'linux',
      writeWarning: warningSink().sink,
    });

    expect(prctl).toHaveBeenCalledTimes(1);
    expect(prctl).toHaveBeenCalledWith(4, 0, 0, 0, 0);
  });

  it('invokes prctl on Linux when credential-bearing even if SANDBOX is unset', async () => {
    delete process.env.SANDBOX;
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/cred.sock';
    const prctl = prctlSpy();
    await applyProcessMemoryHardening({
      prctl,
      platform: 'linux',
      writeWarning: warningSink().sink,
    });

    expect(prctl).toHaveBeenCalledTimes(1);
    expect(prctl).toHaveBeenCalledWith(4, 0, 0, 0, 0);
  });

  it('invokes prctl on Linux when LLXPRT_CAPABILITY_FD is set even if SANDBOX is unset', async () => {
    delete process.env.SANDBOX;
    process.env.LLXPRT_CAPABILITY_FD = '3';
    const prctl = prctlSpy();
    await applyProcessMemoryHardening({
      prctl,
      platform: 'linux',
      writeWarning: warningSink().sink,
    });

    expect(prctl).toHaveBeenCalledTimes(1);
  });

  it('does not invoke prctl when not sandboxed and not credential-bearing (Linux)', async () => {
    delete process.env.SANDBOX;
    clearCredentialMarkers();
    const prctl = prctlSpy();
    await applyProcessMemoryHardening({
      prctl,
      platform: 'linux',
    });

    expect(prctl).not.toHaveBeenCalled();
  });

  it("does not invoke prctl when SANDBOX is 'sandbox-exec' and not credential-bearing", async () => {
    process.env.SANDBOX = 'sandbox-exec';
    clearCredentialMarkers();
    const prctl = prctlSpy();
    await applyProcessMemoryHardening({
      prctl,
      platform: 'linux',
    });

    expect(prctl).not.toHaveBeenCalled();
  });

  it.each<NodeJS.Platform>(['darwin', 'win32'])(
    'does not invoke prctl off Linux (platform=%s) even when SANDBOX is set',
    async (platform) => {
      process.env.SANDBOX = 'docker-llxprt-sandbox-0';
      const prctl = prctlSpy();
      await applyProcessMemoryHardening({ prctl, platform });

      expect(prctl).not.toHaveBeenCalled();
    },
  );
});

describe('applyProcessMemoryHardening — warn-and-continue (not credential-bearing, AC3)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...process.env };
    process.env.SANDBOX = 'docker-llxprt-sandbox-0';
    clearCredentialMarkers();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('warns and returns normally when prctl returns non-zero', async () => {
    const prctl = vi.fn((() => -1) as PrctlCallable);
    const { sink, messages } = warningSink();

    await expect(
      applyProcessMemoryHardening({
        prctl,
        platform: 'linux',
        writeWarning: sink,
      }),
    ).resolves.toBeUndefined();

    expect(prctl).toHaveBeenCalledWith(4, 0, 0, 0, 0);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/memory hardening/i);
    expect(messages[0]).toContain('-1');
  });

  it('warns and returns normally when prctl throws', async () => {
    const prctl = vi.fn((() => {
      throw new Error('boom');
    }) as PrctlCallable);
    const { sink, messages } = warningSink();

    await expect(
      applyProcessMemoryHardening({
        prctl,
        platform: 'linux',
        writeWarning: sink,
      }),
    ).resolves.toBeUndefined();

    expect(prctl).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/threw/);
    expect(messages[0]).toContain('boom');
  });

  it('uses the default stderr writer without throwing when no warning sink is injected', async () => {
    // Exercises the production default warning path (process.stderr.write) to
    // prove it does not throw; prctl is injected so no bun:ffi is touched.
    const prctl = vi.fn((() => 1) as PrctlCallable);

    await expect(
      applyProcessMemoryHardening({ prctl, platform: 'linux' }),
    ).resolves.toBeUndefined();

    expect(prctl).toHaveBeenCalledTimes(1);
  });
});

describe('applyProcessMemoryHardening — fail-closed (credential-bearing, Blocker #1)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...process.env };
    process.env.SANDBOX = 'docker-llxprt-sandbox-0';
    process.env.LLXPRT_CAPABILITY_FD = '3';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('FAILS CLOSED (throws FatalError exit 44) when credential-bearing and prctl returns non-zero', async () => {
    const prctl = vi.fn((() => -1) as PrctlCallable);
    const { sink, messages } = warningSink();

    let caught: unknown;
    try {
      await applyProcessMemoryHardening({
        prctl,
        platform: 'linux',
        writeWarning: sink,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FatalError);
    expect((caught as FatalError).exitCode).toBe(44);
    // The warning sink must NOT have been called — we threw, not warned.
    expect(messages).toHaveLength(0);
  });

  it('FAILS CLOSED when credential-bearing and prctl throws', async () => {
    const prctl = vi.fn((() => {
      throw new Error('boom');
    }) as PrctlCallable);
    const { sink } = warningSink();

    await expect(
      applyProcessMemoryHardening({
        prctl,
        platform: 'linux',
        writeWarning: sink,
      }),
    ).rejects.toBeInstanceOf(FatalError);
  });

  it('FAILS CLOSED when credential-bearing and prctl cannot be resolved (null)', async () => {
    const { sink } = warningSink();

    await expect(
      // Injecting null models "prctl could not be resolved from libc" and
      // short-circuits resolveLibcPrctl(), so this stays deterministic under
      // both Node and Bun rather than depending on bun:ffi availability.
      applyProcessMemoryHardening({
        prctl: null,
        platform: 'linux',
        writeWarning: sink,
      }),
    ).rejects.toBeInstanceOf(FatalError);
  });

  it('FAILS CLOSED when credential-bearing via LLXPRT_CREDENTIAL_SOCKET even if SANDBOX is unset', async () => {
    delete process.env.SANDBOX;
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/cred.sock';
    const prctl = vi.fn((() => -1) as PrctlCallable);
    const { sink } = warningSink();

    await expect(
      applyProcessMemoryHardening({
        prctl,
        platform: 'linux',
        writeWarning: sink,
      }),
    ).rejects.toBeInstanceOf(FatalError);
  });
});

describe('applyProcessMemoryHardening — bootstrap ordering (AC4)', () => {
  /**
   * The full bootstrap (packages/cli/index.ts) launches the Bun relauncher and
   * then starts the CLI; it cannot be executed inside a unit test without
   * running the entire launcher/main pipeline. The realistic falsifiable
   * assertion for AC4 is over the real production file: the hardening call is
   * awaited inside the post-relaunch callback and lexically precedes the
   * dynamic import of the CLI module. Moving it after that import, removing the
   * await, or dropping the call makes this test fail.
   *
   * Real behavioral coverage that the production function makes the process
   * non-dumpable is in `integration-tests/sandboxPrivilege.real.test.ts`
   * (AC4-E2E: exercises the real production function in a real container and
   * asserts /proc maps ownership). A full index.ts launch is not possible in
   * the current sandbox image (the core barrel transitively requires sharp);
   * this lexical test is the guard that index.ts actually calls the function.
   */
  function readBootstrapSource(): string {
    return readFileSync(join(__dirname, '..', '..', 'index.ts'), 'utf8');
  }

  it('awaits applyProcessMemoryHardening before importing the CLI module', () => {
    const src = readBootstrapSource();

    expect(src).toMatch(
      /import\s*\{[^}]*\bapplyProcessMemoryHardening\b[^}]*\}\s*from\s*['"]\.\/src\/launcher\/process-memory-hardening\.js['"]/,
    );

    const hardeningIndex = src.indexOf('await applyProcessMemoryHardening()');
    const cliImportIndex = src.indexOf("import('./src/cli.js')");

    expect(hardeningIndex).toBeGreaterThan(-1);
    expect(cliImportIndex).toBeGreaterThan(-1);
    expect(hardeningIndex).toBeLessThan(cliImportIndex);
  });
});
