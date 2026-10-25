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
  vi,
} from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { clientSkillNames } from './helpers/skill-declaration-reads.js';
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

  let directory: string;

  let evidence: string;

  let reloadPolicy: () => Promise<Partial<SkillPolicy>>;

  const opened: Array<{ close(): Promise<void> }> = [];

  function arithmeticServers(): Record<
    string,
    { command: string; args: string[] }
  > {
    return {
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
    };
  }

  async function openCaller(): Promise<SkillWorkspaceSession> {
    const caller = await openSkillWorkspaceSession({
      authority: credentials().authority,
      overrides: {
        workingDir: directory,
        skillsSupport: true,
        mcpServers: arithmeticServers(),
        harness: { includeProcessCwd: false },
      },
      operations: {
        reloadPolicy: () => reloadPolicy(),
        registerTools: registerActivateSkillTool,
      },
    });
    opened.push(caller);
    const failures = await caller.mcp.awaitDiscovery();
    if (failures.size > 0)
      throw new Error(
        `Physical MCP discovery failed: ${JSON.stringify(Array.from(failures))}`,
      );
    return caller;
  }

  async function openAgent(): Promise<
    Awaited<ReturnType<typeof openRouteAAgent>>
  > {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      config: {
        workingDir: directory,
        skillsSupport: true,
        mcpServers: arithmeticServers(),
        harness: { includeProcessCwd: false },
      },
    });
    opened.push(built);
    await awaitMcpDiscoveryReady(built.agent);
    return built;
  }

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-registrar-admission-')),
    );
    await writeSkill('alpha');
    reloadPolicy = async () => ({});
    evidence = join(directory, 'mcp');
    await mkdir(evidence);
  });

  afterEach(async () => {
    try {
      for (const entry of opened.splice(0).reverse()) await entry.close();
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

  function gate(): { promise: Promise<void>; release(): void } {
    let release = (): void => {
      throw new Error('Gate not initialized');
    };
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  async function turn(
    agent: Awaited<ReturnType<typeof openRouteAAgent>>['agent'],
  ): Promise<void> {
    for await (const event of agent.stream('hello')) {
      if (event.type === 'error') throw new Error('Physical turn failed');
    }
  }

  it('publishes a reload accepted before root closure and denies the next reload', async () => {
    const caller = await openCaller();
    const entered = gate();
    const released = gate();
    reloadPolicy = async () => {
      entered.release();
      await released.promise;
      return {};
    };
    try {
      expect(clientSkillNames(caller.client).sort()).toStrictEqual(['alpha']);
      await writeSkill('beta');
      const accepted = caller.mcp.workspaceSkills.operations.reload();
      await entered.promise;
      caller.mcp.closeAdmission();
      await expect(
        caller.mcp.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      expect(clientSkillNames(caller.client).sort()).toStrictEqual(['alpha']);
      released.release();
      await accepted;
      expect(clientSkillNames(caller.client).sort()).toStrictEqual([
        'alpha',
        'beta',
      ]);
      expect(caller.mcp.workspaceSkills.operations.find('beta')?.location).toBe(
        join(directory, '.agents', 'skills', 'beta', 'SKILL.md'),
      );
      await caller.mcp.dispose();
      expect(clientSkillNames(caller.client).sort()).toStrictEqual([]);
    } finally {
      released.release();
    }
  });

  it('joins held publication and compensation before retiring the catalog', async () => {
    const caller = await openCaller();
    const entered = gate();
    const released = gate();
    const primary = new Error('Held publication failed after mutation');
    const publish = caller.client.setTools.bind(caller.client);
    const publications: string[][] = [];
    let candidateHeld = false;
    const fault = vi
      .spyOn(caller.client, 'setTools')
      .mockImplementation(async (...args) => {
        await publish(...args);
        const names = clientSkillNames(caller.client).sort();
        if (candidateHeld || names.includes('beta')) publications.push(names);
        if (!candidateHeld && names.includes('beta')) {
          candidateHeld = true;
          entered.release();
          await released.promise;
          throw primary;
        }
      });
    let disposal: Promise<void> | undefined;
    try {
      await writeSkill('beta');
      const accepted = caller.mcp.workspaceSkills.operations.reload();
      const result = accepted.catch((error: unknown) => error);
      await entered.promise;
      caller.mcp.closeAdmission();
      let retired = false;
      disposal = caller.mcp.dispose().then(() => {
        retired = true;
      });
      await Promise.resolve();
      expect(retired).toBe(false);
      await expect(
        caller.mcp.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      released.release();
      expect(await result).toBe(primary);
      await disposal;
      expect(publications).toStrictEqual([['alpha', 'beta'], ['alpha'], []]);
      expect(clientSkillNames(caller.client).sort()).toStrictEqual([]);
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
    }
  });

  it.each([false, true])(
    'closes borrowed facades in either order without closing their caller root: %s',
    async (reverse) => {
      const first = (await openAgent()).agent;
      const second = (await openAgent()).agent;
      await turn(first);
      const [closing, surviving] = reverse ? [second, first] : [first, second];
      await closing.dispose();
      await expect(closing.skills.reload()).rejects.toThrow('closed');
      await writeSkill('beta');
      await surviving.skills.reload();
      expect(
        surviving.skills
          .list()
          .map((skill) => skill.name)
          .sort(),
      ).toStrictEqual(['alpha', 'beta']);
      await surviving.dispose();
      await expect(surviving.skills.reload()).rejects.toThrow('closed');
    },
  );
});
