/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3083 — sandbox enablement precedence (flag > env > settings).
 *
 * These are Bun-native tests (registered in scripts/bun-test-manifest.ts and
 * excluded from the Vitest selection in packages/cli/vitest.test-groups.ts).
 * They drive the REAL `loadSandboxConfig` and assert on its real return value
 * (`{ command, image }` / `undefined`) and on real thrown `FatalSandboxError`
 * messages. The only substituted dependency is the `command-exists` engine
 * availability probe — a real binary check would make these tests host-
 * dependent.
 *
 * Test APIs come from `bun:test`; `vi` is imported from
 * `bun:test`, whose `vi` the
 * repository preload (`test-setup/augment-bun-vi.ts`) augments at runtime with
 * the Vitest-compatible methods (`vi.mock`, `vi.hoisted`, `vi.restoreAllMocks`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { loadSandboxConfig } from './sandboxConfig.js';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';

const { commandSyncMock } = {
  commandSyncMock: vi.fn(),
};

void vi.mock('command-exists', () => ({
  default: {
    sync: commandSyncMock,
  },
}));

const ORIGINAL_ENV = { ...process.env };

function makeSettings(sandbox?: boolean | string): Settings {
  return { sandbox } as Settings;
}

/**
 * Configure which sandbox engines the (substituted) availability probe reports
 * as installed. Everything else reports as missing.
 */
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

describe('sandbox precedence (issue #3083)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SANDBOX;
    delete process.env.LLXPRT_SANDBOX;
    delete process.env.LLXPRT_SANDBOX_IMAGE;
    // Docker is the default available engine for the "enabled" cases.
    enginesAvailable('docker');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('AC1: explicit --sandbox (true) enables even when LLXPRT_SANDBOX=false', async () => {
    process.env.LLXPRT_SANDBOX = 'false';
    const config = await loadSandboxConfig(makeSettings(false), {
      sandbox: true,
    });
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
  });

  it('AC2: --sandbox false beats LLXPRT_SANDBOX=docker (returns undefined)', async () => {
    process.env.LLXPRT_SANDBOX = 'docker';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandbox: false,
    });
    expect(config).toBeUndefined();
  });

  it('AC2: --no-sandbox beats LLXPRT_SANDBOX=true (returns undefined)', async () => {
    process.env.LLXPRT_SANDBOX = 'true';
    const config = await loadSandboxConfig(makeSettings(undefined), {
      sandbox: false,
    });
    expect(config).toBeUndefined();
  });

  it('AC3: flag absent, LLXPRT_SANDBOX=docker selects that engine', async () => {
    process.env.LLXPRT_SANDBOX = 'docker';
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
  });

  it('AC3: flag absent, LLXPRT_SANDBOX=true auto-detects an engine', async () => {
    process.env.LLXPRT_SANDBOX = 'true';
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
  });

  it('AC3: flag absent, LLXPRT_SANDBOX=1 enables (auto-detect)', async () => {
    process.env.LLXPRT_SANDBOX = '1';
    const config = await loadSandboxConfig(makeSettings(undefined), {});
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
  });

  it('AC3: flag absent, LLXPRT_SANDBOX=0 disables (returns undefined)', async () => {
    process.env.LLXPRT_SANDBOX = '0';
    const config = await loadSandboxConfig(makeSettings(true), {});
    expect(config).toBeUndefined();
  });

  it('AC4: both flag and env absent, settings.sandbox=true enables', async () => {
    const config = await loadSandboxConfig(makeSettings(true), {});
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
  });

  it('AC5: whitespace-only LLXPRT_SANDBOX is absent, falls through to settings', async () => {
    process.env.LLXPRT_SANDBOX = '   ';
    const config = await loadSandboxConfig(makeSettings(true), {});
    expect(config).toBeDefined();
    expect(config?.command).toBe('docker');
  });

  it('AC6: --sandbox-engine none short-circuits regardless of flag/env/settings', async () => {
    process.env.LLXPRT_SANDBOX = 'docker';
    const config = await loadSandboxConfig(makeSettings(true), {
      sandbox: true,
      sandboxEngine: 'none',
    });
    expect(config).toBeUndefined();
  });

  it('AC7: SANDBOX env set yields no nested sandbox', async () => {
    process.env.SANDBOX = '1';
    const config = await loadSandboxConfig(makeSettings(true), {
      sandbox: true,
    });
    expect(config).toBeUndefined();
  });

  it('AC8: missing-command error names LLXPRT_SANDBOX when env supplied it', async () => {
    enginesAvailable();
    process.env.LLXPRT_SANDBOX = 'docker';
    const error = await expectFatalSandbox(makeSettings(undefined), {});
    expect(error.message).toContain("'docker'");
    expect(error.message).toContain('(from LLXPRT_SANDBOX)');
  });

  it('AC8: missing-command error names settings.sandbox when settings supplied it', async () => {
    enginesAvailable();
    const error = await expectFatalSandbox(makeSettings('podman'), {});
    expect(error.message).toContain("'podman'");
    expect(error.message).toContain('(from settings.sandbox)');
  });

  it('AC8: auto-detect failure names --sandbox and its engine flag', async () => {
    enginesAvailable();
    const error = await expectFatalSandbox(makeSettings(undefined), {
      sandbox: true,
    });
    expect(error.message).toContain('--sandbox');
    expect(error.message).toContain('--sandbox-engine');
  });

  it('AC8: auto-detect failure names LLXPRT_SANDBOX and env guidance', async () => {
    enginesAvailable();
    process.env.LLXPRT_SANDBOX = 'true';
    const error = await expectFatalSandbox(makeSettings(undefined), {});
    expect(error.message).toContain('LLXPRT_SANDBOX');
    expect(error.message).toContain(
      'set LLXPRT_SANDBOX to docker, podman, or sandbox-exec',
    );
  });

  it('AC8: auto-detect failure names settings.sandbox and settings guidance', async () => {
    enginesAvailable();
    const error = await expectFatalSandbox(makeSettings(true), {});
    expect(error.message).toContain('settings.sandbox');
    expect(error.message).toContain(
      'set settings.sandbox to docker, podman, or sandbox-exec',
    );
  });
});
