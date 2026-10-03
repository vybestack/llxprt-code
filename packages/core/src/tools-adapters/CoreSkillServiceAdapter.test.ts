/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Storage } from '@vybestack/llxprt-code-settings';
import { SkillManager } from '../skills/skillManager.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { CoreSkillServiceAdapter } from './CoreSkillServiceAdapter.js';

describe('skill service port', () => {
  it('activates a skill from an explicit manager and adds its resource directory to the supplied workspace', async () => {
    const manager = new SkillManager();
    const workspace = new WorkspaceContext(process.cwd());
    const storage = new Storage(process.cwd());
    const extensions = [
      {
        name: 'explicit-port-extension',
        version: '1',
        path: process.cwd(),
        isActive: true,
        contextFiles: [],
        skills: [
          {
            name: 'explicit-port-skill',
            description: 'Use the explicit port',
            body: 'Read these instructions',
            location: `${process.cwd()}/SKILL.md`,
          },
        ],
      },
    ];
    const adapter = new CoreSkillServiceAdapter(
      manager,
      storage,
      () => extensions,
      workspace,
    );
    await manager.discoverSkills(storage, extensions);
    const result = await adapter.activateSkill('explicit-port-skill');
    expect(result.success).toBe(true);
    if (result.resourceDirectory === undefined)
      throw new Error('Skill directory missing');
    expect(workspace.getDirectories()).toContain(result.resourceDirectory);
  });
});
