/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from './__tests__/command-owner-fixture.js';
import { handleSlashCommand } from './nonInteractiveCliCommands.js';

describe('headless custom command authority', () => {
  const makeOwner = useCommandOwners();
  it('loads commands using the captured live trust reader instead of an attached Agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'headless-command-owner-'));
    const config = new Config({
      sessionId: 'headless-owner',
      targetDir: root,
      cwd: root,
      model: 'fake',
      provider: 'fake',
      debugMode: false,
      storageRoot: join(root, 'storage'),
      folderTrust: true,
    });
    const owner = await makeOwner('headless-command-owner', {});
    const peer = await makeOwner('headless-command-peer', {});
    try {
      await mkdir(config.projectCommandsDir, { recursive: true });
      await writeFile(
        join(config.projectCommandsDir, 'owned.toml'),
        'prompt = "Captured workspace command"\n',
      );
      await peer.ide.setTrustedFolderLive(false);
      const metrics = Object.assign(() => owner.metrics.getMetrics(), {
        ide: peer.ide,
        metrics: peer.metrics,
      });
      const trust = () => owner.ide.isTrustedFolder();
      expect(
        await handleSlashCommand(
          '/owned',
          new AbortController(),
          config,
          metrics,
          trust,
        ),
      ).toBe('Captured workspace command');
      await owner.ide.setTrustedFolderLive(false);
      expect(
        await handleSlashCommand(
          '/owned',
          new AbortController(),
          config,
          metrics,
          trust,
        ),
      ).toBeUndefined();
      await owner.dispose();
      await peer.ide.setTrustedFolderLive(true);
      expect(
        await handleSlashCommand(
          '/owned',
          new AbortController(),
          config,
          () => peer.metrics.getMetrics(),
          () => peer.ide.isTrustedFolder(),
        ),
      ).toBe('Captured workspace command');
    } finally {
      await config.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
