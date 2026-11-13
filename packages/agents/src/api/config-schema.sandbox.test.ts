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

  it('still rejects unknown sandbox fields', () => {
    expect(
      AgentConfigSchema.safeParse({
        ...base,
        sandbox: { command: 'bwrap', privileged: true },
      }).success,
    ).toBe(false);
  });
});
