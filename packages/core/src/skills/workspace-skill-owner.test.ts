/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '../config/config.js';
import { composeWorkspaceSkills } from '../config/skill-tool-sync.js';
import type { WorkspaceSkillOwner } from './workspace-skill-owner.js';
import { testConfigInitialization } from '@vybestack/llxprt-code-test-utils/core/config.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: () => void = () => {
    throw new Error('Uninitialized deferred');
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('workspace skill transactions @issue:2615', () => {
  let directory: string;
  let owner: WorkspaceSkillOwner | undefined;
  let config: Config;
  let filesystem: WorkspaceFilesystemOwner;
  let policyOwner: RuntimePolicyOwner;
  let tooling: ReturnType<typeof testConfigInitialization>['toolCatalog'];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'skill-owner-'));
    config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test',
      skillsSupport: true,
      trustedFolder: true,
    });
    filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => policyOwner.trust.isTrustedFolder(),
    });
    policyOwner = new RuntimePolicyOwner(config);
    const initialization = testConfigInitialization(
      config,
      policyOwner.session.messageBus,
      policyOwner,
      filesystem,
    );
    tooling = initialization.toolCatalog;
    await config.ensureInitialized(initialization);
  });
  afterEach(async () => {
    await owner?.dispose();
    await tooling.dispose();
    await filesystem.dispose();
    owner = undefined;
    await policyOwner.dispose();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  async function writeSkill(name: string, root = '.agents'): Promise<void> {
    const location = join(directory, root, 'skills', name);
    await mkdir(location, { recursive: true });
    await writeFile(
      join(location, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${root} skill\n---\n${root} instructions`,
    );
  }

  it('retains the published catalogue until publication succeeds', async () => {
    await writeSkill('alpha');
    const entered = deferred();
    const release = deferred();
    let blocked = false;
    owner = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      policyOwner.trust,
      () => policyOwner.session.messageBus,
      { reloadPolicy: async () => ({}), registerTools: () => {} },
      () => {
        const lease = tooling.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {
            if (blocked) {
              entered.resolve();
              await release.promise;
            }
          },
          release: lease.release,
        };
      },
    );
    await owner.initialize();
    await writeSkill('beta');
    blocked = true;
    const pending = owner.operations.reload();
    await entered.promise;
    const during = owner.operations.list().map((skill) => skill.name);
    release.resolve();
    await pending;
    expect(during).toStrictEqual(['alpha']);
    expect(
      owner.operations
        .list()
        .map((skill) => skill.name)
        .sort(),
    ).toStrictEqual(['alpha', 'beta']);
  });

  it('serializes reloads and retains live external policy while queued', async () => {
    await writeSkill('alpha');
    const entered = deferred();
    const release = deferred();
    let reloading = false;
    let active = 0;
    let maximum = 0;
    await policyOwner.dispose();
    await config.dispose();
    config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test',
      skillsSupport: true,
    });
    filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => policyOwner.trust.isTrustedFolder(),
    });
    policyOwner = new RuntimePolicyOwner(config);
    await config.ensureInitialized(
      testConfigInitialization(
        config,
        policyOwner.session.messageBus,
        policyOwner,
        filesystem,
      ),
    );
    owner = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      policyOwner.trust,
      () => policyOwner.session.messageBus,
      {
        reloadPolicy: async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          entered.resolve();
          await release.promise;
          active -= 1;
          return {};
        },
        registerTools: () => {},
      },
      () => {
        const lease = tooling.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {
            reloading = true;
          },
          release: lease.release,
        };
      },
    );
    await owner.initialize();
    reloading = false;
    const first = owner.operations.reload();
    await entered.promise;
    const second = owner.operations.reload();
    config.setDisabledSkills(['alpha']);
    expect(owner.operations.list()).toStrictEqual([]);
    expect(reloading).toBe(false);
    release.resolve();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
    expect(owner.operations.list()).toStrictEqual([]);
  });

  it('rolls back failed publication without discarding external policy changes', async () => {
    await writeSkill('alpha');
    let fail = false;
    owner = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      policyOwner.trust,
      () => policyOwner.session.messageBus,
      { reloadPolicy: async () => ({}), registerTools: () => {} },
      () => {
        const lease = tooling.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {
            if (fail) {
              fail = false;
              config.setDisabledSkills(['alpha']);
              throw new Error('publication failed');
            }
          },
          release: lease.release,
        };
      },
    );
    await owner.initialize();
    await writeSkill('beta');
    fail = true;
    await expect(owner.operations.reload()).rejects.toThrow(
      'publication failed',
    );
    expect(
      owner.operations.list(true).map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
    expect(owner.operations.list()).toStrictEqual([]);
    expect(config.getDisabledSkills()).toStrictEqual(['alpha']);
  });

  it('checks disabled admin and trust policy at activation time', async () => {
    await writeSkill('alpha');
    owner = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      policyOwner.trust,
      () => policyOwner.session.messageBus,
      { reloadPolicy: async () => ({}), registerTools: () => {} },
      () => {
        const lease = tooling.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {},
          release: lease.release,
        };
      },
    );
    await owner.initialize();
    expect((await owner.operations.activate('alpha')).instructions).toContain(
      '.agents instructions',
    );
    config.setDisabledSkills(['alpha']);
    expect((await owner.operations.activate('alpha')).success).toBe(false);
    config.setDisabledSkills([]);
    config.setAdminSkillsEnabled(false);
    expect((await owner.operations.activate('alpha')).success).toBe(false);
    config.setAdminSkillsEnabled(true);
    await policyOwner.trust.setTrustedFolderLive(false);
    expect((await owner.operations.activate('alpha')).success).toBe(false);
    await policyOwner.trust.setTrustedFolderLive(true);
    expect((await owner.operations.activate('alpha')).success).toBe(true);
  });

  it('preserves native project precedence and releases the owner on close', async () => {
    await writeSkill('alpha', '.llxprt');
    await writeSkill('alpha');
    owner = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      policyOwner.trust,
      () => policyOwner.session.messageBus,
      { reloadPolicy: async () => ({}), registerTools: () => {} },
      () => {
        const lease = tooling.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {},
          release: lease.release,
        };
      },
    );
    await owner.initialize();
    expect((await owner.operations.activate('alpha')).instructions).toContain(
      '.agents instructions',
    );
    await owner.dispose();
    expect(owner.operations.list(true)).toStrictEqual([]);
    await expect(owner.operations.activate('alpha')).rejects.toThrow(
      'disposed',
    );
    await expect(owner.operations.reload()).rejects.toThrow('disposed');
  });
});
