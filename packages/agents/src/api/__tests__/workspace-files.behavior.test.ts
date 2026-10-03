/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import { StandardFileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolHostAdapter.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

class MarkerFileSystem extends StandardFileSystemService {
  constructor(private readonly marker: string) {
    super();
  }

  override async readTextFile(filePath: string): Promise<string> {
    return `${this.marker}:${filePath}`;
  }
}

describe('session workspace filesystem access', () => {
  it('keeps separate workspace roots and file reads for two agents adopting one Config, without disposing caller resources', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const leftWorkspace = new WorkspaceContext(built.config.getTargetDir());
    const rightWorkspace = new WorkspaceContext(process.cwd());
    const leftFiles = new MarkerFileSystem('left');
    const rightFiles = new MarkerFileSystem('right');
    let left: Agent | undefined;
    let right: Agent | undefined;
    try {
      left = await fromConfig({
        config: built.config,
        workspace: { context: leftWorkspace, fileSystem: leftFiles },
      });
      right = await fromConfig({
        config: built.config,
        workspace: { context: rightWorkspace, fileSystem: rightFiles },
      });
      expect(left.workspace.getDirectories()).toStrictEqual(
        leftWorkspace.getDirectories(),
      );
      expect(right.workspace.getDirectories()).toStrictEqual(
        rightWorkspace.getDirectories(),
      );
      expect(left.workspace.getFileSystemService()).toBe(leftFiles);
      expect(right.workspace.getFileSystemService()).toBe(rightFiles);
      expect(
        await left.workspace.getFileSystemService().readTextFile('/sample'),
      ).toBe('left:/sample');
      expect(
        await right.workspace.getFileSystemService().readTextFile('/sample'),
      ).toBe('right:/sample');
      const leftHost = new CoreToolHostAdapter(built.config, left.workspace);
      const rightHost = new CoreToolHostAdapter(built.config, right.workspace);
      expect(leftHost.getWorkspaceRoots()).toStrictEqual([
        ...leftWorkspace.getDirectories(),
      ]);
      expect(rightHost.getWorkspaceRoots()).toStrictEqual([
        ...rightWorkspace.getDirectories(),
      ]);
      expect(
        await leftHost.getFileSystemService().readTextFile('/sample'),
      ).toBe('left:/sample');
      expect(
        await rightHost.getFileSystemService().readTextFile('/sample'),
      ).toBe('right:/sample');
      await left.dispose();
      left = undefined;
      expect(
        await leftHost.getFileSystemService().readTextFile('/after-dispose'),
      ).toBe('left:/after-dispose');
      expect(
        await right.workspace.getFileSystemService().readTextFile('/sample'),
      ).toBe('right:/sample');
      expect(built.config.getWorkspaceContext()).not.toBe(rightWorkspace);
      expect(built.config.getFileSystemService()).not.toBe(rightFiles);
    } finally {
      await left?.dispose();
      await right?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('does not expose directories or files through the session port after workspace trust is denied', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        config: built.config,
        workspace: {
          context: built.config.getWorkspaceContext(),
          fileSystem: new MarkerFileSystem('denied'),
        },
      });
      const activeAgent = agent;
      await built.config.setTrustedFolderLive(false);
      expect(() => activeAgent.workspace.getDirectories()).toThrow(
        'Workspace access is denied for an untrusted folder',
      );
      expect(() => activeAgent.workspace.getFileSystemService()).toThrow(
        'Workspace access is denied for an untrusted folder',
      );
      expect(agent.getToolRegistry().getTool('read_file')).toBeUndefined();
      expect(() =>
        new CoreToolHostAdapter(
          built.config,
          activeAgent.workspace,
        ).getWorkspaceRoots(),
      ).toThrow('Workspace access is denied for an untrusted folder');
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);
});
