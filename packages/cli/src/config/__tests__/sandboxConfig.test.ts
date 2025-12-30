/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSandboxConfig } from '../sandboxConfig.js';
import type { Settings } from '../settings.js';

const baseSettings: Settings = {
  sandbox: true,
};

vi.mock('../../utils/resolvePath.js', () => ({
  resolvePath: (value: string) => value.replace('~', '/mock/home/user'),
}));

vi.mock('../../utils/package.js', () => ({
  getPackageJson: vi.fn(async () => ({
    config: { sandboxImageUri: 'ghcr.io/vybestack/llxprt-code/sandbox:0.7.0' },
  })),
}));

vi.mock('command-exists', () => ({
  default: {
    sync: vi.fn(
      (command: string) => command === 'docker' || command === 'podman',
    ),
  },
}));

vi.mock('../sandboxProfiles.js', () => ({
  ensureDefaultSandboxProfiles: vi.fn(async () => undefined),
  loadSandboxProfile: vi.fn(async () => ({
    engine: 'docker',
    image: 'ghcr.io/vybestack/llxprt-code/sandbox:0.7.0',
    resources: { cpus: 2, memory: '4g', pids: 128 },
    network: 'off',
    sshAgent: 'on',
    mounts: [{ from: '~/.llxprt', to: '/home/node/.llxprt', mode: 'rw' }],
    env: { SAMPLE_ENV: 'true' },
  })),
}));

const ORIGINAL_ENV = { ...process.env };

describe('loadSandboxConfig', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LLXPRT_SANDBOX_NETWORK;
    delete process.env.LLXPRT_SANDBOX_SSH_AGENT;
    delete process.env.LLXPRT_SANDBOX_CPUS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.LLXPRT_SANDBOX_PIDS;
    delete process.env.LLXPRT_SANDBOX_MOUNTS;
    delete process.env.SANDBOX;
    delete process.env.LLXPRT_SANDBOX;
    delete process.env.LLXPRT_SANDBOX_IMAGE;
    process.env.HOME = '/mock/home/user';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  it('applies sandbox profile settings and env vars', async () => {
    process.env.LLXPRT_SANDBOX_NETWORK = 'on';

    const config = await loadSandboxConfig(baseSettings, {
      sandboxProfileLoad: 'dev',
      sandboxEngine: 'auto',
    });

    expect(config).toEqual({
      command: 'docker',
      image: 'ghcr.io/vybestack/llxprt-code/sandbox:0.7.0',
    });
    expect(process.env.LLXPRT_SANDBOX_NETWORK).toBe('off');
    expect(process.env.LLXPRT_SANDBOX_SSH_AGENT).toBe('on');
    expect(process.env.LLXPRT_SANDBOX_CPUS).toBe('2');
    expect(process.env.LLXPRT_SANDBOX_MEMORY).toBe('4g');
    expect(process.env.LLXPRT_SANDBOX_PIDS).toBe('128');
    expect(process.env.LLXPRT_SANDBOX_MOUNTS).toContain('/home/node/.llxprt');
    expect(process.env.SANDBOX_MOUNTS).toContain('/home/node/.llxprt');
    expect(process.env.SAMPLE_ENV).toBe('true');
  });

  it('disables sandbox when engine is none', async () => {
    const config = await loadSandboxConfig(baseSettings, {
      sandboxEngine: 'none',
    });

    expect(config).toBeUndefined();
  });
});
