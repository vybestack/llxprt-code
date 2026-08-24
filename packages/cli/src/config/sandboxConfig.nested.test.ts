/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2943 — the SANDBOX env var only proves a nested LLxprt launch when
 * its value is one LLxprt itself writes (the Seatbelt `sandbox-exec` literal
 * or a generated container name like `sandbox-0.7.0-4242`). Foreign
 * values (CI systems, hand exports) must not suppress an explicit sandbox request.
 *
 * Modeled on sandboxConfig.precedence.test.ts: real `loadSandboxConfig`, only
 * `command-exists` (the infra probe) substituted, plus `./sandboxProfiles.js`
 * for the profile row. Rows cover the AC1-AC4 matrix from the issue plan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { loadSandboxConfig } from './sandboxConfig.js';
import type { Settings } from './settings.js';

const commandSyncMock = vi.fn((_command: string) => false);

void vi.mock('command-exists', () => ({
  default: {
    sync: commandSyncMock,
  },
}));

void vi.mock('./sandboxProfiles.js', () => ({
  ensureDefaultSandboxProfiles: vi.fn(async () => undefined),
  loadSandboxProfile: vi.fn(async () => ({
    engine: 'docker',
    image: 'ghcr.io/vybestack/llxprt-code/sandbox:0.7.0',
    resources: { cpus: 2, memory: '4g', pids: 128 },
    network: 'off',
    sshAgent: 'on',
  })),
}));

const ORIGINAL_ENV = { ...process.env };

function makeSettings(sandbox?: boolean | string): Settings {
  return { sandbox };
}

function silenceWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

function enginesAvailable(...available: readonly string[]): void {
  const set = new Set(available);
  commandSyncMock.mockImplementation((command: string) => set.has(command));
}

async function expectFatalSandbox(
  settings: Settings,
  argv: Record<string, unknown>,
): Promise<FatalSandboxError> {
  try {
    await loadSandboxConfig(settings, argv);
  } catch (error) {
    expect(error).toBeInstanceOf(FatalSandboxError);
    return error as FatalSandboxError;
  }
  throw new Error('expected loadSandboxConfig to throw');
}

describe('nested SANDBOX detection (issue #2943)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SANDBOX;
    delete process.env.LLXPRT_SANDBOX;
    delete process.env.LLXPRT_SANDBOX_IMAGE;
    // Clean up the vars applySandboxProfileEnv writes so the profile row starts
    // from the same baseline.
    delete process.env.LLXPRT_SANDBOX_NETWORK;
    delete process.env.LLXPRT_SANDBOX_SSH_AGENT;
    delete process.env.LLXPRT_SANDBOX_CPUS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.LLXPRT_SANDBOX_PIDS;
    delete process.env.LLXPRT_SANDBOX_MOUNTS;
    enginesAvailable('docker');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('AC1: foreign SANDBOX="1" does not suppress --sandbox docker', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = '1';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandbox: true,
    });
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC1: foreign SANDBOX="true" does not suppress LLXPRT_SANDBOX=true', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'true';
    process.env.LLXPRT_SANDBOX = 'true';
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC1: foreign SANDBOX="some-ci-value" does not suppress --sandbox-engine', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'some-ci-value';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandboxEngine: 'docker',
    });
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC2: LLxprt-written SANDBOX="sandbox-exec" suppresses --sandbox with warning', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-exec';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandbox: true,
    });
    expect(config).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String((warnSpy.mock.calls[0] ?? [])[0] ?? '');
    expect(message).toContain('SANDBOX=sandbox-exec');
    expect(message).toContain('--sandbox');
  });

  it('AC2: container-name SANDBOX suppresses settings.sandbox with warning', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-0.7.0-4242';
    const config = await loadSandboxConfig(makeSettings(true), {});
    expect(config).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String((warnSpy.mock.calls[0] ?? [])[0] ?? '');
    expect(message).toContain('SANDBOX=sandbox-0.7.0-4242');
    expect(message).toContain('settings.sandbox');
  });

  it('AC2: collision-suffixed container name suppresses LLXPRT_SANDBOX with warning', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-0.7.0-4242-1';
    process.env.LLXPRT_SANDBOX = 'true';
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String((warnSpy.mock.calls[0] ?? [])[0] ?? '');
    expect(message).toContain('SANDBOX=sandbox-0.7.0-4242-1');
    expect(message).toContain('LLXPRT_SANDBOX');
  });

  it('AC2: LLxprt-written SANDBOX suppresses --sandbox-engine with warning', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-exec';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandboxEngine: 'docker',
    });
    expect(config).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String((warnSpy.mock.calls[0] ?? [])[0] ?? '');
    expect(message).toContain('SANDBOX=sandbox-exec');
    expect(message).toContain('--sandbox-engine');
  });

  it('AC2: LLxprt-written SANDBOX suppresses --sandbox-profile-load with warning', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-exec';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandboxProfileLoad: 'dev',
    });
    expect(config).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String((warnSpy.mock.calls[0] ?? [])[0] ?? '');
    expect(message).toContain('SANDBOX=sandbox-exec');
    expect(message).toContain('--sandbox-profile-load');
  });

  it('AC3: LLxprt-written SANDBOX with no request stays silent', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-exec';
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC3: SANDBOX unset with no request stays silent', async () => {
    const warnSpy = silenceWarn();
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC4: LLxprt-written SANDBOX with --sandbox false is not a request', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = 'sandbox-exec';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandbox: false,
    });
    expect(config).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AC1: foreign SANDBOX="1" does not weaken --sandbox validation', async () => {
    const warnSpy = silenceWarn();
    process.env.SANDBOX = '1';
    const error = await expectFatalSandbox(makeSettings(undefined), {
      sandbox: 'nosuchcmd',
    });
    expect(error.message).toContain('nosuchcmd');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
