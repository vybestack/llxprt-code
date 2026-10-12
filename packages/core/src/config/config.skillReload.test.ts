import type { WorkspaceSkillAssemblyOperations } from './skill-tool-sync.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, type ConfigParameters } from './config.js';
import { WorkspaceToolCatalogOwner } from '../services/workspace-tool-catalog-owner.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { initializeTestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';
import type { WorkspaceSkillOwner } from '../skills/workspace-skill-owner.js';

interface RegistrarObservation {
  readonly skills: string[];
}

describe('workspace reload refreshes the model-facing skill surface @issue:3379', () => {
  let directory: string;
  let close: (() => Promise<void>) | undefined;
  let owner: Pick<WorkspaceSkillOwner, 'operations' | 'refresh'>;
  let observations: RegistrarObservation[];
  let registrationFailure = false;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'workspace-skill-reload-'));
    observations = [];
    registrationFailure = false;
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  async function writeSkill(name: string): Promise<void> {
    const location = join(directory, '.agents', 'skills', name);
    await mkdir(location, { recursive: true });
    await writeFile(
      join(location, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} description\n---\nInstructions for ${name}`,
    );
  }

  async function build(
    overrides: Partial<ConfigParameters> = {},
    operations: Partial<WorkspaceSkillAssemblyOperations> = {},
  ): Promise<Config> {
    const config = new Config({
      sessionId: 'skill-session',
      targetDir: directory,
      cwd: directory,
      model: 'test-model',
      debugMode: false,
      skillsSupport: true,
      ...overrides,
    });
    const runtime = await initializeTestMcpRuntime(
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        reloadPolicy: async () => ({}),
        registerTools: (_registry, service) => {
          if (registrationFailure) throw new Error('registration failed');
          observations.push({
            skills: service
              .listSkills()
              .map((skill) => skill.name)
              .sort(),
          });
        },
        ...operations,
      },
    );
    owner = runtime.workspaceSkills;
    close = async () => {
      await runtime.dispose();
      await config.dispose();
    };
    observations.length = 0;
    return config;
  }

  it('rebuilds the activation tool from the post-reload skill set', async () => {
    await writeSkill('alpha');
    await build();
    await writeSkill('beta');
    await owner.operations.reload();
    expect(observations).toStrictEqual([{ skills: ['alpha', 'beta'] }]);
  });

  it('rebuilds the activation tool even when no skills remain', async () => {
    await writeSkill('alpha');
    await build();
    await rm(join(directory, '.agents', 'skills', 'alpha'), {
      recursive: true,
    });
    await owner.operations.reload();
    expect(observations).toStrictEqual([{ skills: [] }]);
  });

  it('does not rebuild the activation tool when skills support is off', async () => {
    await writeSkill('alpha');
    await build({ skillsSupport: false });
    await owner.operations.reload();
    expect(observations).toStrictEqual([]);
    expect(owner.operations.list(true)).toStrictEqual([]);
  });

  it('hides a skill that the reload disabled', async () => {
    await writeSkill('alpha');
    await writeSkill('beta');
    await build(
      {},
      { reloadPolicy: async () => ({ disabledSkills: ['beta'] }) },
    );
    await owner.operations.reload();
    expect(
      owner.operations
        .list(true)
        .map((skill) => skill.name)
        .sort(),
    ).toStrictEqual(['alpha', 'beta']);
    expect(observations).toStrictEqual([{ skills: ['alpha'] }]);
  });

  it('pushes refreshed declarations to the chat session after rebuilding the tool', async () => {
    const sequence: string[] = [];
    const config = await build(
      {},
      {
        registerTools: () => {
          sequence.push('registrar');
        },
      },
    );
    const { composeWorkspaceSkills } = await import('./skill-tool-sync.js');
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      isTrusted: () => trust.isTrustedFolder(),
    });
    const bus = new MessageBus();
    const tooling = new WorkspaceToolCatalogOwner(config, bus, trust);
    const publishingOwner = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      trust,
      () => bus,
      {
        reloadPolicy: async () => ({}),
        registerTools: () => {
          sequence.push('registrar');
        },
      },
      () => {
        const lease = tooling.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {
            sequence.push('setTools');
          },
          release: lease.release,
        };
      },
    );
    sequence.length = 0;
    try {
      await publishingOwner.initialize();
      expect(sequence).toStrictEqual(['registrar', 'setTools']);
    } finally {
      await publishingOwner.dispose();
      await tooling.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await config.dispose();
    }
  });

  it('completes without a chat session to refresh', async () => {
    await build();
    await expect(owner.operations.reload()).resolves.toBeUndefined();
  });

  it('propagates a rebuild failure instead of reporting a successful reload', async () => {
    await writeSkill('alpha');
    await build();
    registrationFailure = true;
    await writeSkill('beta');
    await expect(owner.operations.reload()).rejects.toThrow(
      'registration failed',
    );
    expect(owner.operations.list().map((skill) => skill.name)).toStrictEqual([
      'alpha',
    ]);
    registrationFailure = false;
  });
});
