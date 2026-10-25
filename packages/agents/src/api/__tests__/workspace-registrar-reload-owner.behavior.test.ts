import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SkillPolicy } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openSkillWorkspaceSession,
  type SkillWorkspaceSession,
} from './helpers/skill-workspace-session.js';

describe('workspace registrar and skill reload root admission', () => {
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
  const credentials = useOwnedCredentials();

  let caller: SkillWorkspaceSession;

  let directory: string;

  let reloadPolicy: () => Promise<Partial<SkillPolicy>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'workspace-registrar-admission-'));
    await writeSkill('alpha');
    reloadPolicy = async () => ({});
    const evidence = join(directory, 'mcp');
    await mkdir(evidence);
    caller = await openSkillWorkspaceSession({
      authority: credentials().authority,
      overrides: {
        workingDir: directory,
        skillsSupport: true,
        mcpServers: {
          arithmetic: {
            command: process.execPath,
            args: [
              resolveRepositoryFixture(
                import.meta.url,
                'scripts/tests/mcp-standalone-stdio-fixture.ts',
              ),
              evidence,
            ],
          },
        },
        harness: { includeProcessCwd: false },
      },
      operations: {
        reloadPolicy: () => reloadPolicy(),
        registerTools: registerActivateSkillTool,
      },
    });
    const failures = await caller.mcp.awaitDiscovery();
    if (failures.size > 0)
      throw new Error(
        `Physical MCP discovery failed: ${JSON.stringify(Array.from(failures))}`,
      );
  });

  afterEach(async () => {
    try {
      await caller.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function writeSkill(name: string): Promise<void> {
    const root = join(directory, '.agents', 'skills', name);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Instructions for ${name}\n---\n\nUse the ${name} operation.\n`,
    );
  }

  it('discovers actual skill files, activates their contents and registers their schema', async () => {
    const mcpRuntime = caller.mcp;
    const skill = mcpRuntime.workspaceSkills.operations.find('alpha');
    if (skill === undefined)
      throw new Error('Physical skill was not discovered');
    const result =
      await mcpRuntime.workspaceSkills.operations.activate('alpha');
    expect(
      mcpRuntime.toolSelection
        .getFunctionDeclarations()
        .map((tool) => tool.name),
    ).toContain('mcp__arithmetic__sum');
    expect(result.success).toBe(true);
    if (result.instructions === undefined)
      throw new Error('Skill activation did not return instructions');
    expect(await readFile(skill.location, 'utf8')).toContain(
      result.instructions,
    );
    expect(
      mcpRuntime.toolSelection
        .getFunctionDeclarations()
        .map((tool) => tool.name),
    ).toContain('activate_skill');
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((entry) => entry.name),
    ).toStrictEqual(['alpha']);
  });

  it('does not retain registrar or skill reload executable authority on Config', () => {
    const config = caller.config;
    for (const name of [
      'postSkillDiscoveryToolRegistrar',
      'getPostSkillDiscoveryToolRegistrar',
      'setPostSkillDiscoveryToolRegistrar',
      '_onReload',
      'getSkillSettingsReloader',
    ]) {
      expect(name in config).toBe(false);
    }
  });

  it('rejects a skill reload admitted after root closure without publishing new files', async () => {
    const mcpRuntime = caller.mcp;
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
    await writeSkill('beta');
    mcpRuntime.closeAdmission();
    await expect(
      mcpRuntime.workspaceSkills.operations.reload(),
    ).rejects.toThrow(/closed|disposed|stopped/);
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
  });
});
