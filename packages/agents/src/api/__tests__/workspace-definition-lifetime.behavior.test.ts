import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

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
  const callerCredentials = useOwnedCredentials();

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

  it.each([0, 1])(
    'retains physical definitions when borrowed facade %s closes first',
    async (closingIndex) => {
      const definitions = new WorkspaceDefinitionOwner(
        join(root, 'config/profiles'),
        join(root, 'config/subagents'),
      );
      const open = () =>
        createAgent({
          provider: 'fake',
          model: 'fake-model',
          workingDir: root,
          harness: { includeProcessCwd: false, forceConfirmations: false },
          credentialAuthority: callerCredentials().authority,
          definitionOwner: definitions,
          definitionOwnership: 'caller',
        });
      const first = await open();
      const second = await open();
      const closing = closingIndex === 0 ? first : second;
      const peer = closingIndex === 0 ? second : first;
      try {
        await peer.saveProfileSnapshot('route');
        await definitions.subagentWrites.saveSubagent(
          'worker',
          'route',
          'Read the workspace',
        );
        const persisted = JSON.parse(
          await readFile(join(root, 'config/profiles/route.json'), 'utf8'),
        );
        expect(Object.keys(persisted.modelParams).sort()).toStrictEqual(
          Object.keys(peer.captureProfile().modelParams).sort(),
        );
        expect(await definitions.subagentReads.listSubagents()).toContain(
          'worker',
        );
        await closing.dispose();
        await expect(closing.saveProfileSnapshot('denied')).rejects.toThrow(
          'closed',
        );
        await peer.saveProfileSnapshot('peer');
        expect(
          (await definitions.profileReads.listProfiles()).sort(),
        ).toStrictEqual(['peer', 'route']);
        await peer.dispose();
        await definitions.subagentWrites.deleteSubagent('worker');
        await definitions.profileWrites.deleteProfile('peer');
        expect(await definitions.profileReads.listProfiles()).toStrictEqual([
          'route',
        ]);
      } finally {
        await first.dispose();
        await second.dispose();
        await definitions.dispose();
      }
    },
    30000,
  );

  it('keeps explicitly borrowed definition directories independent for same-label facades', async () => {
    const leftRoot = new WorkspaceDefinitionOwner(
      join(root, 'left/profiles'),
      join(root, 'left/subagents'),
    );
    const rightRoot = new WorkspaceDefinitionOwner(
      join(root, 'right/profiles'),
      join(root, 'right/subagents'),
    );
    const open = (definitions: WorkspaceDefinitionOwner) =>
      createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: root,
        sessionId: 'equal-definition-label',
        credentialAuthority: callerCredentials().authority,
        definitionOwner: definitions,
        definitionOwnership: 'caller',
      });
    const left = await open(leftRoot);
    const right = await open(rightRoot);
    try {
      await left.saveProfileSnapshot('route');
      await right.saveProfileSnapshot('route');
      await leftRoot.subagentWrites.saveSubagent(
        'left-worker',
        'route',
        'Inspect left',
      );
      await rightRoot.subagentWrites.saveSubagent(
        'right-worker',
        'route',
        'Inspect right',
      );
      expect(
        await left.workspace.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['left-worker']);
      expect(
        await right.workspace.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['right-worker']);
      await left.workspace.profileWrites.deleteProfile('route');
      expect(
        await right.workspace.profileDefinitions.listProfiles(),
      ).toStrictEqual(['route']);
      expect(
        await left.workspace.profileDefinitions.listProfiles(),
      ).toStrictEqual([]);
      await left.dispose();
      await leftRoot.profileWrites.saveProfile(
        'survivor',
        right.captureProfile(),
      );
      expect(await leftRoot.profileReads.listProfiles()).toStrictEqual([
        'survivor',
      ]);
      expect(
        JSON.parse(
          await readFile(join(root, 'right/profiles/route.json'), 'utf8'),
        ).version,
      ).toBe(1);
    } finally {
      await left.dispose();
      await right.dispose();
      await leftRoot.dispose();
      await rightRoot.dispose();
    }
  }, 30000);
});
