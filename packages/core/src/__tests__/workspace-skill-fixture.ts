/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { AcquisitionRelease } from '../lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '../policy/policy-owner.js';
import { WorkspaceToolCatalogOwner } from '../services/workspace-tool-catalog-owner.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import type { Config } from '../config/config.js';
import {
  composeWorkspaceSkills,
  type WorkspaceSkillAssemblyOperations,
} from '../config/skill-tool-sync.js';
import type { WorkspaceSkillOwner } from '../skills/workspace-skill-owner.js';
export function installTestWorkspaceSkills(): (
  config: Config,
  operations?: WorkspaceSkillAssemblyOperations,
  readExtensions?: () => ReturnType<Config['getExtensions']>,
) => Promise<WorkspaceSkillOwner> {
  const resources: AcquisitionRelease[] = [];
  afterEach(async () => {
    const results = await Promise.allSettled(
      resources
        .splice(0)
        .reverse()
        .map((owner) => owner.rollback()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Workspace skill fixture cleanup failed',
      );
  });
  return async (
    config,
    operations = { reloadPolicy: async () => ({}), registerTools: () => {} },
    readExtensions,
  ) => {
    const journal = new AcquisitionRelease();
    resources.push(journal);
    try {
      const policy = new RuntimePolicyOwner(config);
      journal.acquire('policy', () => policy.dispose());
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: config.getTargetDir(),
        includeDirectories: config.getConfiguredIncludeDirectories(),
        isTrusted: () => policy.trust.isTrustedFolder(),
      });
      journal.acquire('files', () => filesystem.dispose());
      const tools = new WorkspaceToolCatalogOwner(
        config,
        policy.session.messageBus,
        policy.trust,
      );
      journal.acquire('files', () => tools.dispose());
      const skills = composeWorkspaceSkills(
        config,
        (directory, approved) =>
          filesystem.admitSkillDirectory(directory, approved),
        () => filesystem.notifyTrustChanged(),
        policy.trust,
        () => policy.session.messageBus,
        operations,
        () => {
          const lease = tools.acceptSkillPublication();
          return {
            registry: lease.registry,
            publish: async () => {},
            release: lease.release,
          };
        },
        readExtensions,
      );
      journal.acquire('files', () => skills.dispose());
      await skills.initialize();
      return skills;
    } catch (primary) {
      resources.splice(resources.indexOf(journal), 1);
      try {
        await journal.rollback();
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          'Workspace skill acquisition and cleanup failed',
        );
      }
      throw primary;
    }
  };
}
