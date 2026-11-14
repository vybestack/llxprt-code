/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { toConfigParameters } from './agentConfig.adapter.js';
import { AgentConfigSchema } from './config-schema.js';

const base = { provider: 'openai', model: 'test-model' } as const;

describe('AgentConfigSchema sandbox', () => {
  it('accepts an ordinary bwrap sandbox configuration', () => {
    const result = AgentConfigSchema.safeParse({
      ...base,
      sandbox: {
        command: 'bwrap',
        mounts: [{ from: '/opt/tools', to: '/opt/tools', mode: 'ro' }],
        env: { RUSTUP_HOME: '/opt/rustup' },
        network: 'off',
        sshAgent: 'off',
      },
    });

    expect(result.success).toBe(true);
  });

  it('carries a bwrap configuration through the adapter to the runtime configuration', () => {
    const { sandbox } = AgentConfigSchema.parse({
      ...base,
      sandbox: { command: 'bwrap', network: 'off' },
    });

    expect(toConfigParameters({ ...base, sandbox }).sandbox).toStrictEqual({
      command: 'bwrap',
      network: 'off',
    });
  });

  it('still accepts a container sandbox configuration', () => {
    const result = AgentConfigSchema.safeParse({
      ...base,
      sandbox: { command: 'docker', image: 'example/sandbox:1' },
    });

    expect(result.success).toBe(true);
  });

  it('carries bwrap device grants through the adapter to the runtime configuration', () => {
    const { sandbox } = AgentConfigSchema.parse({
      ...base,
      sandbox: { command: 'bwrap', devices: ['/dev/dri/renderD128'] },
    });

    expect(toConfigParameters({ ...base, sandbox }).sandbox).toStrictEqual({
      command: 'bwrap',
      devices: ['/dev/dri/renderD128'],
    });
  });

  it('carries container device grants through the adapter to the runtime configuration', () => {
    const { sandbox } = AgentConfigSchema.parse({
      ...base,
      sandbox: {
        command: 'docker',
        image: 'example/sandbox:1',
        devices: ['/dev/dri/renderD128'],
      },
    });

    expect(toConfigParameters({ ...base, sandbox }).sandbox).toStrictEqual({
      command: 'docker',
      image: 'example/sandbox:1',
      devices: ['/dev/dri/renderD128'],
    });
  });

  it.each([
    ['a string', '/dev/dri'],
    ['a non-string element', ['/dev/dri', 3]],
    ['more than 64 entries', Array.from({ length: 65 }, () => '/dev/null')],
  ])('rejects devices given as %s', (_name, devices) => {
    expect(
      AgentConfigSchema.safeParse({
        ...base,
        sandbox: { command: 'bwrap', devices },
      }).success,
    ).toBe(false);
  });

  it('still rejects unknown sandbox fields', () => {
    expect(
      AgentConfigSchema.safeParse({
        ...base,
        sandbox: { command: 'bwrap', privileged: true },
      }).success,
    ).toBe(false);
  });
});
