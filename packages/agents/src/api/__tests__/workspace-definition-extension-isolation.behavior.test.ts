import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
} from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openSkillWorkspaceSession } from './helpers/skill-workspace-session.js';

describe('public Agent workspace definition lifetime', () => {
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

  useFakeResponsesReplay('multi-turn-text.jsonl');
  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  let root: string;

  const directories: string[] = [];

  let previousHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-public-definitions-'));
    directories.push(root);
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  });

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('isolates extension catalogues on an explicitly shared disk root and withdraws only the closing workspace', async () => {
    await mkdir(join(root, 'first'), { recursive: true });
    await mkdir(join(root, 'second'), { recursive: true });
    const shared = new WorkspaceDefinitionOwner(
      join(root, 'shared/profiles'),
      join(root, 'shared/subagents'),
    );
    const { mcp: firstCallerMcp, close: firstCallerClose } =
      await openSkillWorkspaceSession({
        authority: firstCredentials().authority,
        overrides: {
          workingDir: join(root, 'first'),
          definitionOwner: shared,
          definitionOwnership: 'caller',
          harness: { includeProcessCwd: false, forceConfirmations: false },
        },
      });
    const { mcp: secondCallerMcp, close: secondCallerClose } =
      await openSkillWorkspaceSession({
        authority: secondCredentials().authority,
        overrides: {
          workingDir: join(root, 'second'),
          definitionOwner: shared,
          definitionOwnership: 'caller',
          harness: { includeProcessCwd: false, forceConfirmations: false },
        },
      });
    try {
      await shared.profileWrites.saveProfile('route', {
        version: 1,
        provider: 'fake',
        model: 'definition-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      await shared.subagentWrites.saveSubagent(
        'durable',
        'route',
        'Read shared files',
      );
      await firstCallerMcp.extensionOperations.load({
        name: 'first-extension',
        version: '1.0',
        path: root,
        isActive: true,
        contextFiles: [],
        subagents: [
          {
            name: 'first-worker',
            profile: 'route',
            systemPrompt: 'First workspace',
          },
        ],
      });
      await secondCallerMcp.extensionOperations.load({
        name: 'second-extension',
        version: '1.0',
        path: root,
        isActive: true,
        contextFiles: [],
        subagents: [
          {
            name: 'second-worker',
            profile: 'route',
            systemPrompt: 'Second workspace',
          },
        ],
      });
      expect(
        await firstCallerMcp.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable', 'first-worker']);
      expect(
        await secondCallerMcp.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable', 'second-worker']);
      await firstCallerMcp.trust.setTrustedFolderLive(false);
      expect(
        await firstCallerMcp.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable']);
      expect(
        await secondCallerMcp.subagentDefinitions.listSubagents(),
      ).toContain('second-worker');
      await firstCallerClose();
      expect(
        await secondCallerMcp.subagentDefinitions.listSubagents(),
      ).toContain('second-worker');
      await secondCallerMcp.extensionOperations.unload(
        secondCallerMcp.extensionOperations.list()[0],
      );
      expect(
        await secondCallerMcp.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable']);
      await shared.profileWrites.saveProfile('retained', {
        version: 1,
        provider: 'fake',
        model: 'retained-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(await shared.profileReads.listProfiles()).toContain('retained');
    } finally {
      await firstCallerClose();
      await secondCallerClose();
      await shared.dispose();
    }
  }, 30000);
});
