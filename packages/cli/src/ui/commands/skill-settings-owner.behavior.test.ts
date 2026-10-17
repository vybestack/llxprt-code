/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import { LoadedSettings } from '../../config/settings.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { bindSkillsCommand } from './skillsCommandHost.js';
import { createSkillsCommand } from './skillsCommand.js';

function settingsAt(root: string): LoadedSettings {
  return new LoadedSettings(
    { settings: {}, path: join(root, 'system.json') },
    { settings: {}, path: join(root, 'defaults.json') },
    { settings: {}, path: join(root, 'user.json') },
    { settings: {}, path: join(root, 'workspace.json') },
    true,
  );
}

function disabledSkills(settings: LoadedSettings): string[] {
  const disabled = settings.merged.skills?.disabled;
  if (disabled === undefined) throw new Error('Missing fixture skill policy');
  return disabled;
}

async function skillOwner(
  root: string,
  settings: LoadedSettings,
): Promise<WorkspaceSkillOwner> {
  const catalogue = join(root, 'skills');
  await mkdir(join(catalogue, 'read-resource'), { recursive: true });
  await writeFile(
    join(catalogue, 'read-resource', 'SKILL.md'),
    '---\nname: read-resource\ndescription: Read workspace resources\n---\nRead the resource.',
  );
  const owner = new WorkspaceSkillOwner({
    directories: {
      userSkillsDir: join(root, 'user-skills'),
      userAgentSkillsDir: join(root, 'user-agent-skills'),
      projectSkillsDir: catalogue,
      projectAgentSkillsDir: join(root, 'agent-skills'),
    },
    enabled: () => true,
    readExtensions: () => [],
    readPolicy: () => ({
      disabledSkills: [...disabledSkills(settings)],
      adminSkillsEnabled: true,
    }),
    applyPolicy: () => {},
    reloadPolicy: async () => ({}),
    isTrusted: () => true,
    addDirectory: () => () => {},
    notifyDirectoriesChanged: () => {},
    acceptPublication: () => ({
      rebuild: () => () => {},
      publish: async () => {},
      release: () => {},
    }),
  });
  await owner.initialize();
  return owner;
}

describe('registered skill settings owner', () => {
  const makeOwner = useCommandOwners();

  it('persists skill changes to the registered workspace and leaves a sibling live', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const settings = settingsAt(owner.workspace.getWorkingDirectory());
    const otherSettings = settingsAt(sibling.workspace.getWorkingDirectory());
    const skills = await skillOwner(
      owner.workspace.getWorkingDirectory(),
      settings,
    );
    const otherSkills = await skillOwner(
      sibling.workspace.getWorkingDirectory(),
      otherSettings,
    );
    try {
      const command = createSkillsCommand(
        bindSkillsCommand(
          skills.operations,
          true,
          settings,
          () => 0,
          () => {},
        ),
      );
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), skillsCommand: command },
            createMockCommandContext({
              services: {
                config: {
                  isSkillsSupportEnabled: () => true,
                  isAdminSkillsEnabled: () => true,
                  getEnableHooksUI: () => false,
                },
              },
            }).services.config,
          ),
        ],
        new AbortController().signal,
      );
      const disable = registry
        .getCommands()
        .find((entry) => entry.name === 'skills')
        ?.subCommands?.find((entry) => entry.name === 'disable');
      if (!disable?.action)
        throw new Error('Skill disable command unavailable');
      await disable.action(
        createMockCommandContext({
          services: { agent: sibling, settings: otherSettings, config: null },
        }),
        'read-resource',
      );

      const persisted: unknown = JSON.parse(
        await readFile(settings.workspace.path, 'utf8'),
      );
      expect(persisted).toMatchObject({
        skills: { disabled: ['read-resource'] },
      });
      expect(disabledSkills(otherSettings)).toStrictEqual([]);
      await skills.dispose();
      await owner.dispose();
      expect(
        otherSkills.operations.list().map((skill) => skill.name),
      ).toStrictEqual(['read-resource']);
    } finally {
      await skills.dispose();
      await otherSkills.dispose();
    }
  });
});
