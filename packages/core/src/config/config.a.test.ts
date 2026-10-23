/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Config } from './config.js';
import { GitService } from '../services/gitService.js';
import { WorkspaceCheckpointOwner } from '../services/workspace-checkpoint-owner.js';
import { WorkspaceMcpCatalogOwner } from '../services/workspace-mcp-catalog-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createBaseParams,
  buildGitServiceMockBody,
} from './__tests__/configTestHarness.js';
void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());
describe('Server Config (config.ts)', () => {
  const owners: Array<{ dispose(): void | Promise<void> }> = [];
  const baseParams = createBaseParams(new SettingsService());
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const owner of owners.splice(0).reverse()) {
      try {
        await owner.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Workspace startup fixture cleanup failed',
      );
  });
  describe('initialize', () => {
    it('should throw an error if checkpointing is enabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      vi.spyOn(GitService.prototype, 'initialize').mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      const checkpoints = new WorkspaceCheckpointOwner(
        config.getTargetDir(),
        config.projectHistoryDir,
        config.getCheckpointingEnabled(),
      );
      const initialization = checkpoints.initialize();
      const disposal = checkpoints.dispose();
      await expect(initialization).rejects.toThrow(gitError);
      await expect(disposal).rejects.toThrow(gitError);
    });

    it('returns an independently owned workspace catalog without storing registries on Config', async () => {
      const config = new Config({ ...baseParams, checkpointing: false });
      const catalog = new WorkspaceMcpCatalogOwner(
        () => true,
        async () => {
          throw new Error('No resource transport selected');
        },
      );
      owners.push(catalog);
      catalog.resourcePublication.setResourcesForServer('fixture', [
        { name: 'entry', uri: 'fixture:///entry' },
      ]);
      expect(
        catalog.resourceSelection.findResource('fixture:fixture:///entry'),
      ).toMatchObject({
        serverName: 'fixture',
        name: 'entry',
        uri: 'fixture:///entry',
      });
      expect('getResourceRegistry' in config).toBe(false);
      expect('getPromptRegistry' in config).toBe(false);
      await catalog.dispose();
      expect(() => catalog.resourceSelection.listResources()).toThrow(
        'stopped',
      );
    });
  });
});
