import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import type { SkillsControl } from '../control/skillsControl.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { clientSkillNames } from './helpers/skill-declaration-reads.js';
import { openSkillsOwner } from './helpers/skills-owner-session.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end coverage for issue #3379.
 *
 * `/skills reload` used to refresh SkillManager and stop there, so a skill
 * added on disk never reached the model. The model learns which skills exist
 * from exactly one place: the `activate_skill` declaration carried in the tool
 * list that ChatSession hands to the provider on every request. These tests
 * therefore assert on that declaration rather than on which functions were
 * called.
 *
 * The whole production chain runs for real, with nothing supplied by the test:
 * skill files on disk, the real SkillManager, the registrar `createAgent`
 * installs, the real ActivateSkillTool, a real ToolRegistry, the real
 * AgentClient.setTools(), and the real ChatSession.
 *
 * This file used to install the registrar itself, because `createAgent` did not
 * (issue #3382). Now that it does, these cases also cover that wiring: removing
 * it from `createAgent` fails every test here.
 */

function writeSkill(workspace: string, name: string): void {
  const skillDir = join(workspace, '.llxprt', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n${name} instructions\n`,
    'utf-8',
  );
}

describe('workspace skill publication compensation', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  useFakeResponsesReplay('plain-text.jsonl');
  const callerCredentials = useOwnedCredentials();
  async function withWorkspace(
    initialSkills: string[],
    run: (ctx: {
      client: AgentClientContract;
      skills: SkillsControl;
      config: Config;
      workspace: string;
    }) => Promise<void>,
    operations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
    for (const name of initialSkills) {
      writeSkill(workspace, name);
    }
    // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
    // so discovery never reads the real ~/.agents/skills here; the strict set
    // assertions only ever see this workspace's skills.
    const { client, skills, config, close } = await openSkillsOwner({
      authority: callerCredentials().authority,
      overrides: {
        skillsSupport: true,
        workingDir: workspace,
      },
      operations,
    });
    try {
      await run({ client, skills, config, workspace });
    } finally {
      await close();
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  it('restores actual provider declarations and registration after publication mutates then rejects', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ client, skills, config, workspace }) => {
        expect(clientSkillNames(client)).toStrictEqual(['alpha']);
        const publish = client.setTools.bind(client);
        const fault = vi
          .spyOn(client, 'setTools')
          .mockImplementationOnce(async () => {
            await publish();
            expect(clientSkillNames(client).sort()).toStrictEqual(['beta']);
            throw new Error('publication failed after mutation');
          });
        writeSkill(workspace, 'beta');
        try {
          await expect(skills.reload()).rejects.toThrow(
            'publication failed after mutation',
          );
          expect(config.getDisabledSkills()).toStrictEqual([]);
          expect(skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
          expect(clientSkillNames(client)).toStrictEqual(['alpha']);
        } finally {
          fault.mockRestore();
        }
      },
      {
        reloadPolicy: async () => ({ disabledSkills: ['alpha'] }),
        registerTools: registerActivateSkillTool,
      },
    );
  });

  it('reports the publication and compensation failures after restoring the real registration', async () => {
    await withWorkspace(['alpha'], async ({ client, skills, workspace }) => {
      expect(clientSkillNames(client)).toStrictEqual(['alpha']);
      const publish = client.setTools.bind(client);
      const failed = new Error('candidate publication failed');
      const compensation = new Error('compensation publication failed');
      const fault = vi
        .spyOn(client, 'setTools')
        .mockImplementationOnce(async () => {
          await publish();
          throw failed;
        })
        .mockImplementationOnce(async () => {
          await publish();
          throw compensation;
        });
      writeSkill(workspace, 'beta');
      try {
        const error: unknown = await skills
          .reload()
          .catch((reason: unknown) => reason);
        if (!(error instanceof Error) || !('cause' in error))
          throw new Error(
            'Expected a control error with its publication cause',
          );
        expect(error.cause).toBeInstanceOf(AggregateError);
        if (!(error.cause instanceof AggregateError))
          throw new Error('Expected aggregated publication errors');
        expect(error.cause.errors).toStrictEqual([failed, compensation]);
        expect(clientSkillNames(client)).toStrictEqual(['alpha']);
      } finally {
        fault.mockRestore();
      }
    });
  });
});
